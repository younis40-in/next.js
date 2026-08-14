import type {
  Metadata,
  ResolvedMetadata,
  ResolvedViewport,
  Viewport,
} from './types/metadata-interface'
import type { MetadataContext } from './types/resolvers'
import type { LoaderTree } from '../../server/lib/app-dir-module'
import type { ParsedUrlQuery } from 'querystring'
import type { StaticMetadata } from './types/icons'
import type { Params } from '../../server/request/params'
import type { IconDescriptor } from './types/metadata-types'
// eslint-disable-next-line import/no-extraneous-dependencies
import 'server-only'

import {
  createDefaultMetadata,
  createDefaultViewport,
} from './default-metadata'
import { getSegmentParam } from '../../shared/lib/router/utils/get-segment-param'
import {
  getComponentTypeModule,
  getLayoutOrPageModule,
} from '../../server/lib/app-dir-module'
import { createServerParamsForMetadata } from '../../server/request/params'
import { DEFAULT_SEGMENT_KEY, PAGE_SEGMENT_KEY } from '../../shared/lib/segment'
import { PARALLEL_ROUTE_DEFAULT_PATH } from '../../client/components/builtin/default'
import { PARALLEL_ROUTE_DEFAULT_NULL_PATH } from '../../client/components/builtin/default-null'
import { workAsyncStorage } from '../../server/app-render/work-async-storage.external'
import { InvariantError } from '../../shared/lib/invariant-error'
import * as Log from '../../build/output/log'
import { getUseCacheFunctionInfo } from '../client-and-server-references'
import { createLazyResult } from '../../server/lib/lazy-result'
import {
  getAccessFallbackErrorTypeByStatus,
  getAccessFallbackHTTPStatus,
  isHTTPAccessFallbackError,
} from '../../client/components/http-access-fallback/http-access-fallback'
import { isRedirectError } from '../../client/components/redirect-error'
import {
  type BuildState,
  type InstrumentedResolver,
  type MetadataErrorType,
  type MetadataResolver,
  type SegmentProps,
  type SelectedMetadata,
  type StaticIcons,
  type TitleTemplates,
  type ViewportResolver,
  convertUrlsToStrings,
  createSelectedMetadata,
  getDefinedMetadata,
  getDefinedViewport,
  isFavicon,
  mergeMetadata,
  mergeViewport,
  postProcessMetadata,
  resolveStaticMetadata,
} from './metadata-resolution-primitives'

type MetadataResolutionStatus =
  | 'resolved'
  | MetadataErrorType
  | 'redirect'
  | 'error'

type ResolutionOutcome<T> = {
  status: MetadataResolutionStatus
  value: T | undefined
  error: unknown | null
  parallelRouteKeys: string[]
}

type MetadataBranchOutcome = ResolutionOutcome<SelectedMetadata> & {
  warnings: Set<string> | null
}
type ViewportBranchOutcome = ResolutionOutcome<ResolvedViewport>

type BranchOutcomes = {
  metadata: Promise<MetadataBranchOutcome>
  viewport: Promise<ViewportBranchOutcome>
}

type MetadataResolution = {
  selected: Promise<MetadataBranchOutcome>
  selectedViewport: Promise<ViewportBranchOutcome>
  selectedParallelRouteKeys: string[]
  outlets: Map<LoaderTree, BranchOutcomes>
}

type MetadataAccumulator = {
  metadata: ResolvedMetadata
  titleTemplates: TitleTemplates
  favicon: IconDescriptor | null
  leafSegmentStaticIcons: StaticIcons
  buildState: BuildState
}

type ViewportAccumulator = {
  viewport: ResolvedViewport
}

type ErrorMetadataLayer = {
  metadata: Metadata | MetadataResolver | null
  viewport: Viewport | ViewportResolver | null
  staticFilesMetadata: StaticMetadata
}

type MetadataBranch = {
  metadata: Promise<MetadataBranchOutcome>
  viewport: Promise<ViewportBranchOutcome>
  parallelRouteKeys: string[]
  depth: number
  isBuiltinFallback: boolean
}

type MetadataAndViewportLayer = {
  metadata: Metadata | MetadataResolver | null
  viewport: Viewport | ViewportResolver | null
  staticFilesMetadata: StaticMetadata
  errorLayer: ErrorMetadataLayer | null
}

async function collectMetadataAndViewport({
  tree,
  props,
  route,
  errorConvention,
  resolveMetadata: shouldResolveMetadata,
  resolveViewport: shouldResolveViewport,
}: {
  tree: LoaderTree
  props: SegmentProps
  route: string
  errorConvention: MetadataErrorType | undefined
  resolveMetadata: boolean
  resolveViewport: boolean
}): Promise<MetadataAndViewportLayer> {
  const hasErrorConventionComponent = Boolean(
    errorConvention && tree[2][errorConvention]
  )
  const [moduleResult, staticFilesMetadata] = await Promise.all([
    errorConvention
      ? getComponentTypeModule(tree, 'layout').then((mod) => ({
          mod,
          modType: errorConvention,
        }))
      : getLayoutOrPageModule(tree),
    shouldResolveMetadata ? resolveStaticMetadata(tree[2], props) : null,
  ])

  if (moduleResult.modType) {
    route += `/${moduleResult.modType}`
  }

  const metadata =
    shouldResolveMetadata && moduleResult.mod
      ? getDefinedMetadata(moduleResult.mod, props, { route })
      : null
  const viewport =
    shouldResolveViewport && moduleResult.mod
      ? getDefinedViewport(moduleResult.mod, props, { route })
      : null

  let errorLayer: ErrorMetadataLayer | null = null
  if (hasErrorConventionComponent && errorConvention) {
    const errorMod = await getComponentTypeModule(tree, errorConvention)
    errorLayer = {
      metadata:
        shouldResolveMetadata && errorMod
          ? getDefinedMetadata(errorMod, props, { route })
          : null,
      viewport:
        shouldResolveViewport && errorMod
          ? getDefinedViewport(errorMod, props, { route })
          : null,
      staticFilesMetadata,
    }
  }

  return {
    metadata,
    viewport,
    staticFilesMetadata,
    errorLayer,
  }
}

type Result<T> = null | T | Promise<null | T> | PromiseLike<null | T>
type PrerenderedResult<TData extends object, TResolved> = {
  resolveParent: ((value: TResolved) => void) | null
  result: Result<TData>
}

function callResolver<T>(resolver: () => T | Promise<T>): T | Promise<T> {
  let result: T | Promise<T>
  try {
    result = resolver()
  } catch (error) {
    result = Promise.reject(error)
  }

  if (result instanceof Promise) {
    // Generators are eagerly executed, so attach a rejection handler before
    // an earlier layer can suspend or fail.
    result.catch(() => null)
  }
  return result
}

function getResult<TData extends object, TResolved>(
  exportForResult: null | TData | InstrumentedResolver<TData, TResolved>
): PrerenderedResult<TData, TResolved> {
  if (typeof exportForResult === 'function') {
    // If the function is a 'use cache' function that uses the parent data as
    // the second argument, we don't want to eagerly execute it during
    // metadata/viewport pre-rendering, as the parent data might also be
    // computed from another 'use cache' function. To ensure that the hanging
    // input abort signal handling works in this case (i.e. the depending
    // function waits for the cached input to resolve while encoding its args),
    // they must be called sequentially. This can be accomplished by wrapping
    // the call in a lazy promise, so that the original function is only called
    // when the result is actually awaited.
    const useCacheFunctionInfo = getUseCacheFunctionInfo(
      exportForResult.$$original
    )
    if (useCacheFunctionInfo && useCacheFunctionInfo.usedArgs[1]) {
      let resolveParent: (value: TResolved) => void
      const promise = new Promise<TResolved>((resolve) => {
        resolveParent = resolve
      })
      return {
        resolveParent: resolveParent!,
        result: createLazyResult(async () => exportForResult(promise)),
      }
    } else {
      let result: TData | Promise<TData>
      if (useCacheFunctionInfo) {
        result = callResolver(() => {
          // @ts-expect-error We intentionally omit the parent argument, because
          // we know from the check above that the 'use cache' function does not
          // use it.
          return exportForResult()
        })
        return { resolveParent: null, result }
      } else {
        let resolveParent: (value: TResolved) => void
        const parent = new Promise<TResolved>((resolve) => {
          resolveParent = resolve
        })
        result = callResolver(() => exportForResult(parent))
        const prerenderedResult = {
          resolveParent: resolveParent!,
          result,
        }
        return prerenderedResult
      }
    }
  }

  return {
    resolveParent: null,
    result: typeof exportForResult === 'object' ? exportForResult : null,
  }
}

function resolveParentResult<T extends object>(
  parentResult: T,
  resolveParent: (value: T) => void
): void {
  if (process.env.NODE_ENV === 'development') {
    parentResult = (
      require('../../shared/lib/deep-freeze') as typeof import('../../shared/lib/deep-freeze')
    ).deepFreeze(structuredClone(parentResult)) as T
  }

  resolveParent(parentResult)
}

function cloneStaticMetadata(metadata: StaticMetadata): StaticMetadata {
  if (!metadata) return null

  return {
    ...metadata,
    icon: metadata.icon ? [...metadata.icon] : undefined,
    apple: metadata.apple ? [...metadata.apple] : undefined,
    openGraph: metadata.openGraph ? [...metadata.openGraph] : undefined,
    twitter: metadata.twitter ? [...metadata.twitter] : undefined,
  }
}

function createMetadataAccumulator(): MetadataAccumulator {
  return {
    metadata: createDefaultMetadata(),
    titleTemplates: {
      title: null,
      twitter: null,
      openGraph: null,
    },
    favicon: null,
    leafSegmentStaticIcons: {
      icon: [],
      apple: [],
    },
    buildState: {
      warnings: new Set<string>(),
    },
  }
}

function cloneMetadataAccumulator(
  accumulator: MetadataAccumulator
): MetadataAccumulator {
  return {
    metadata: structuredClone(accumulator.metadata),
    titleTemplates: { ...accumulator.titleTemplates },
    favicon: accumulator.favicon ? structuredClone(accumulator.favicon) : null,
    leafSegmentStaticIcons: {
      icon: structuredClone(accumulator.leafSegmentStaticIcons.icon),
      apple: structuredClone(accumulator.leafSegmentStaticIcons.apple),
    },
    buildState: {
      warnings: new Set(accumulator.buildState.warnings),
    },
  }
}

function cloneViewportAccumulator(
  accumulator: ViewportAccumulator
): ViewportAccumulator {
  return {
    viewport: structuredClone(accumulator.viewport),
  }
}

async function accumulateMetadataLayer(
  parent: Promise<MetadataAccumulator>,
  prerendered: PrerenderedResult<Metadata, ResolvedMetadata>,
  staticMetadata: StaticMetadata,
  route: string,
  layerIndex: number,
  pathname: Promise<string>,
  metadataContext: MetadataContext
): Promise<MetadataAccumulator> {
  const accumulator = await parent
  const staticFilesMetadata = cloneStaticMetadata(staticMetadata)

  // Treat favicon as a special case. It should be the first icon in the list.
  // layerIndex <= 1 represents the root layout and a page at the root.
  if (layerIndex <= 1 && isFavicon(staticFilesMetadata?.icon?.[0])) {
    const icon = staticFilesMetadata?.icon?.shift()
    if (layerIndex === 0 && icon) {
      accumulator.favicon = convertUrlsToStrings(icon)
    }
  }

  if (prerendered.resolveParent) {
    resolveParentResult(accumulator.metadata, prerendered.resolveParent)
  }

  let metadata: Metadata | null
  if (isPromiseLike(prerendered.result)) {
    metadata = await prerendered.result
  } else {
    metadata = prerendered.result
  }

  await mergeMetadata(
    route,
    pathname,
    {
      metadata,
      resolvedMetadata: accumulator.metadata,
      staticFilesMetadata,
      titleTemplates: accumulator.titleTemplates,
      metadataContext,
      buildState: accumulator.buildState,
      leafSegmentStaticIcons: accumulator.leafSegmentStaticIcons,
    },
    false
  )

  return accumulator
}

async function accumulateViewportLayer(
  parent: Promise<ViewportAccumulator>,
  prerendered: PrerenderedResult<Viewport, ResolvedViewport>
): Promise<ViewportAccumulator> {
  const accumulator = await parent

  if (prerendered.resolveParent) {
    resolveParentResult(accumulator.viewport, prerendered.resolveParent)
  }

  let viewport: Viewport | null
  if (isPromiseLike(prerendered.result)) {
    viewport = await prerendered.result
  } else {
    viewport = prerendered.result
  }

  mergeViewport({ resolvedViewport: accumulator.viewport, viewport }, false)
  return accumulator
}

function prepareMetadataAccumulatorForChild(
  parent: Promise<MetadataAccumulator>,
  clone: boolean,
  childIsPage: boolean,
  errorConvention: MetadataErrorType | undefined
): Promise<MetadataAccumulator> {
  return parent.then((parentAccumulator) => {
    const accumulator = clone
      ? cloneMetadataAccumulator(parentAccumulator)
      : parentAccumulator

    // A title template applies to a descendant segment, but not to a page in
    // the same segment. Error convention metadata is an additional terminal
    // layer, so the leaf layout's template does apply to it.
    if (!childIsPage || errorConvention) {
      accumulator.titleTemplates = {
        title: accumulator.metadata.title?.template || null,
        openGraph: accumulator.metadata.openGraph?.title.template || null,
        twitter: accumulator.metadata.twitter?.title.template || null,
      }
    }

    return accumulator
  })
}

function prepareViewportAccumulatorForChild(
  parent: Promise<ViewportAccumulator>,
  clone: boolean
): Promise<ViewportAccumulator> {
  return clone ? parent.then(cloneViewportAccumulator) : parent
}

function completeMetadataAccumulator(
  accumulator: MetadataAccumulator,
  metadataContext: MetadataContext
): ResolvedMetadata {
  const { leafSegmentStaticIcons, metadata } = accumulator

  if (
    (leafSegmentStaticIcons.icon.length > 0 ||
      leafSegmentStaticIcons.apple.length > 0) &&
    !metadata.icons
  ) {
    metadata.icons = {
      icon: [],
      apple: [],
    }
    if (leafSegmentStaticIcons.icon.length > 0) {
      metadata.icons.icon.unshift(
        ...convertUrlsToStrings(leafSegmentStaticIcons.icon)
      )
    }
    if (leafSegmentStaticIcons.apple.length > 0) {
      metadata.icons.apple.unshift(
        ...convertUrlsToStrings(leafSegmentStaticIcons.apple)
      )
    }
  }

  return postProcessMetadata(
    metadata,
    accumulator.favicon,
    accumulator.titleTemplates,
    metadataContext
  )
}

type MetadataTreeContext = {
  pathname: Promise<string>
  searchParams: Promise<ParsedUrlQuery>
  errorConvention: MetadataErrorType | undefined
  interpolatedParams: Params
  metadataContext: MetadataContext
  route: string
  selectedParallelRouteKeys: string[] | null
  resolveMetadata: boolean
  resolveViewport: boolean
  outlets: Map<LoaderTree, BranchOutcomes>
}

type MetadataTreeState = {
  tree: LoaderTree
  treePrefix: string[] | null
  parentParams: Params
  parentOptionalCatchAllParamName: string | null
  metadataParent: Promise<MetadataAccumulator>
  viewportParent: Promise<ViewportAccumulator>
  errorLayer: ErrorMetadataLayer | null
  parallelRouteKeys: string[]
  parallelRouteIndex: number
  depth: number
}

type MetadataBranchAtFork = {
  key: string
  branch: MetadataBranch
}

function getMetadataResolutionStatus(error: unknown): MetadataResolutionStatus {
  if (isHTTPAccessFallbackError(error)) {
    return (
      getAccessFallbackErrorTypeByStatus(getAccessFallbackHTTPStatus(error)) ||
      'error'
    )
  }
  if (isRedirectError(error)) {
    return 'redirect'
  }
  return 'error'
}

function createMetadataBranchOutcome(
  pendingAccumulator: Promise<MetadataAccumulator>,
  parallelRouteKeys: string[],
  metadataContext: MetadataContext
): Promise<MetadataBranchOutcome> {
  const completed = pendingAccumulator.then((accumulator) => ({
    value: createSelectedMetadata(
      completeMetadataAccumulator(accumulator, metadataContext)
    ),
    warnings: accumulator.buildState.warnings,
  }))

  return completed.then(
    ({ value, warnings }) => ({
      status: 'resolved',
      value,
      error: null,
      parallelRouteKeys,
      warnings,
    }),
    (error) => ({
      status: getMetadataResolutionStatus(error),
      value: undefined,
      error,
      parallelRouteKeys,
      warnings: null,
    })
  )
}

function createViewportBranchOutcome(
  pendingAccumulator: Promise<ViewportAccumulator>,
  parallelRouteKeys: string[]
): Promise<ViewportBranchOutcome> {
  return pendingAccumulator.then(
    (accumulator) => ({
      status: 'resolved',
      value: accumulator.viewport,
      error: null,
      parallelRouteKeys,
    }),
    (error) => ({
      status: getMetadataResolutionStatus(error),
      value: undefined,
      error,
      parallelRouteKeys,
    })
  )
}

function isPageTree(tree: LoaderTree): boolean {
  const { layout, page, defaultPage } = tree[2]
  return (
    layout === undefined &&
    (page !== undefined ||
      (defaultPage !== undefined && tree[0] === DEFAULT_SEGMENT_KEY))
  )
}

function isBuiltinFallback(tree: LoaderTree): boolean {
  const { defaultPage } = tree[2]
  return (
    defaultPage?.[1].endsWith(PARALLEL_ROUTE_DEFAULT_PATH) === true ||
    defaultPage?.[1].endsWith(PARALLEL_ROUTE_DEFAULT_NULL_PATH) === true
  )
}

function selectDefaultMetadataBranch(
  branches: MetadataBranchAtFork[]
): MetadataBranch {
  if (branches.length === 0) {
    throw new InvariantError('Expected at least one metadata branch')
  }

  let hasRealBranch = false
  for (const candidate of branches) {
    if (!candidate.branch.isBuiltinFallback) {
      hasRealBranch = true
      break
    }
  }

  let selected: MetadataBranchAtFork | null = null
  for (const candidate of branches) {
    if (hasRealBranch && candidate.branch.isBuiltinFallback) {
      continue
    }
    if (selected === null) {
      selected = candidate
      continue
    }
    if (selected.key === 'children') {
      continue
    }
    if (candidate.key === 'children') {
      selected = candidate
      continue
    }
    if (candidate.branch.depth > selected.branch.depth) {
      selected = candidate
      continue
    }
    if (
      candidate.branch.depth === selected.branch.depth &&
      candidate.key < selected.key
    ) {
      selected = candidate
    }
  }

  if (selected === null) {
    throw new InvariantError('Expected at least one selectable metadata branch')
  }
  return selected.branch
}

async function walkMetadataTree(
  context: MetadataTreeContext,
  state: MetadataTreeState
): Promise<MetadataBranch> {
  const [segment, parallelRoutes, { page }] = state.tree
  const currentTreePrefix = state.treePrefix
    ? [...state.treePrefix, segment]
    : [segment]
  const isPage = page !== undefined

  let currentParams = state.parentParams
  const segmentParam = getSegmentParam(segment)
  if (segmentParam) {
    const value = context.interpolatedParams[segmentParam.paramName]
    if (value !== null && value !== undefined) {
      currentParams = {
        ...state.parentParams,
        [segmentParam.paramName]: value,
      }
    }
  }

  const optionalCatchAllParamName: string | null =
    segmentParam?.paramType === 'optional-catchall' &&
    (context.interpolatedParams[segmentParam.paramName] === null ||
      context.interpolatedParams[segmentParam.paramName] === undefined)
      ? segmentParam.paramName
      : state.parentOptionalCatchAllParamName

  const params = createServerParamsForMetadata(
    currentParams,
    optionalCatchAllParamName
  )
  const props: SegmentProps = isPage
    ? { params, searchParams: context.searchParams }
    : { params }
  const route = currentTreePrefix
    .filter((treeSegment) => treeSegment !== PAGE_SEGMENT_KEY)
    .join('/')
  const layer = await collectMetadataAndViewport({
    tree: state.tree,
    props,
    route,
    errorConvention: context.errorConvention,
    resolveMetadata: context.resolveMetadata,
    resolveViewport: context.resolveViewport,
  })

  // Invoke each active generator as soon as this layer is discovered. Its
  // parent promise is resolved later when the preceding accumulator is ready.
  let metadata = state.metadataParent
  if (context.resolveMetadata) {
    const prerenderedMetadata = getResult<Metadata, ResolvedMetadata>(
      layer.metadata
    )
    metadata = accumulateMetadataLayer(
      metadata,
      prerenderedMetadata,
      layer.staticFilesMetadata,
      context.route,
      state.depth,
      context.pathname,
      context.metadataContext
    )
  }
  let viewport = state.viewportParent
  if (context.resolveViewport) {
    const prerenderedViewport = getResult<Viewport, ResolvedViewport>(
      layer.viewport
    )
    viewport = accumulateViewportLayer(viewport, prerenderedViewport)
  }
  const errorLayer = layer.errorLayer || state.errorLayer

  const allParallelRouteKeys = Object.keys(parallelRoutes)
  let parallelRouteKeys = allParallelRouteKeys
  if (context.selectedParallelRouteKeys !== null) {
    const selectedKey =
      context.selectedParallelRouteKeys[state.parallelRouteIndex]
    if (allParallelRouteKeys.length === 0) {
      if (selectedKey !== undefined) {
        throw new InvariantError(
          'Expected selected metadata branch to end at a leaf'
        )
      }
    } else {
      if (selectedKey === undefined || !parallelRoutes[selectedKey]) {
        throw new InvariantError(
          'Expected selected metadata branch to match loader tree'
        )
      }
      parallelRouteKeys = [selectedKey]
    }
  }

  if (parallelRouteKeys.length === 0) {
    if (context.errorConvention) {
      if (context.resolveMetadata) {
        const errorMetadata = getResult<Metadata, ResolvedMetadata>(
          errorLayer?.metadata || null
        )
        metadata = accumulateMetadataLayer(
          metadata,
          errorMetadata,
          errorLayer?.staticFilesMetadata || null,
          context.route,
          state.depth + 1,
          context.pathname,
          context.metadataContext
        )
      }
      if (context.resolveViewport) {
        const errorViewport = getResult<Viewport, ResolvedViewport>(
          errorLayer?.viewport || null
        )
        viewport = accumulateViewportLayer(viewport, errorViewport)
      }
    }

    const metadataOutcome = createMetadataBranchOutcome(
      metadata,
      state.parallelRouteKeys,
      context.metadataContext
    )
    const viewportOutcome = createViewportBranchOutcome(
      viewport,
      state.parallelRouteKeys
    )
    context.outlets.set(state.tree, {
      metadata: metadataOutcome,
      viewport: viewportOutcome,
    })
    return {
      metadata: metadataOutcome,
      viewport: viewportOutcome,
      parallelRouteKeys: state.parallelRouteKeys,
      depth: state.depth,
      isBuiltinFallback: isBuiltinFallback(state.tree),
    }
  }

  const cloneAtFork = parallelRouteKeys.length > 1
  const childBranches = await Promise.all(
    parallelRouteKeys.map(async (parallelRouteKey) => {
      const childTree = parallelRoutes[parallelRouteKey]
      const childParallelRouteKeys = [
        ...state.parallelRouteKeys,
        parallelRouteKey,
      ]
      const branch = await walkMetadataTree(context, {
        tree: childTree,
        treePrefix: currentTreePrefix,
        parentParams: currentParams,
        parentOptionalCatchAllParamName: optionalCatchAllParamName,
        metadataParent: prepareMetadataAccumulatorForChild(
          metadata,
          cloneAtFork && context.resolveMetadata,
          isPageTree(childTree),
          context.errorConvention
        ),
        viewportParent: prepareViewportAccumulatorForChild(
          viewport,
          cloneAtFork && context.resolveViewport
        ),
        errorLayer,
        parallelRouteKeys: childParallelRouteKeys,
        parallelRouteIndex: state.parallelRouteIndex + 1,
        depth: state.depth + 1,
      })
      return { key: parallelRouteKey, branch }
    })
  )

  return selectDefaultMetadataBranch(childBranches)
}

async function resolveMetadataTree(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  errorConvention: MetadataErrorType | undefined,
  interpolatedParams: Params,
  metadataContext: MetadataContext,
  selectedParallelRouteKeys: string[] | null,
  shouldResolveMetadata: boolean,
  shouldResolveViewport: boolean
): Promise<MetadataResolution> {
  const workStore = workAsyncStorage.getStore()
  if (!workStore) {
    throw new InvariantError('Expected workStore to be initialized')
  }

  const outlets = new Map<LoaderTree, BranchOutcomes>()
  const selectedBranch = await walkMetadataTree(
    {
      pathname,
      searchParams,
      errorConvention,
      interpolatedParams,
      metadataContext,
      route: workStore.route,
      selectedParallelRouteKeys,
      resolveMetadata: shouldResolveMetadata,
      resolveViewport: shouldResolveViewport,
      outlets,
    },
    {
      tree,
      treePrefix: null,
      parentParams: {},
      parentOptionalCatchAllParamName: null,
      metadataParent: Promise.resolve(createMetadataAccumulator()),
      viewportParent: Promise.resolve({
        viewport: createDefaultViewport(),
      }),
      errorLayer: null,
      parallelRouteKeys: [],
      parallelRouteIndex: 0,
      depth: 0,
    }
  )

  const selected = selectedBranch.metadata.then((outcome) => {
    if (outcome.warnings) {
      for (const warning of outcome.warnings) {
        Log.warn(warning)
      }
    }
    return outcome
  })

  return {
    selected,
    selectedViewport: selectedBranch.viewport,
    selectedParallelRouteKeys: selectedBranch.parallelRouteKeys,
    outlets,
  }
}

export function resolveMetadataResolution(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  errorConvention: MetadataErrorType | undefined,
  interpolatedParams: Params,
  metadataContext: MetadataContext
): Promise<MetadataResolution> {
  return resolveMetadataTree(
    tree,
    pathname,
    searchParams,
    errorConvention,
    interpolatedParams,
    metadataContext,
    null,
    true,
    true
  )
}

export async function resolveMetadataForBranch(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  errorConvention: MetadataErrorType,
  interpolatedParams: Params,
  metadataContext: MetadataContext,
  selectedParallelRouteKeys: string[]
): Promise<MetadataBranchOutcome> {
  const resolution = await resolveMetadataTree(
    tree,
    pathname,
    searchParams,
    errorConvention,
    interpolatedParams,
    metadataContext,
    selectedParallelRouteKeys,
    true,
    false
  )
  return resolution.selected
}

export async function resolveViewportForBranch(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  errorConvention: MetadataErrorType,
  interpolatedParams: Params,
  metadataContext: MetadataContext,
  selectedParallelRouteKeys: string[]
): Promise<ViewportBranchOutcome> {
  const resolution = await resolveMetadataTree(
    tree,
    pathname,
    searchParams,
    errorConvention,
    interpolatedParams,
    metadataContext,
    selectedParallelRouteKeys,
    false,
    true
  )
  return resolution.selectedViewport
}

function isPromiseLike<T>(
  value: unknown | PromiseLike<T>
): value is PromiseLike<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PromiseLike<unknown>).then === 'function'
  )
}
