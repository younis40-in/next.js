import React, { Suspense, cache } from 'react'
import type { ParsedUrlQuery } from 'querystring'
import type { Params } from '../../server/request/params'
import type { LoaderTree } from '../../server/lib/app-dir-module'
import type {
  MetadataErrorType,
  SelectedMetadata,
} from './metadata-resolution-primitives'
import {
  resolveMetadataForBranch,
  resolveMetadataResolution,
  resolveViewportForBranch,
} from './resolve-metadata-parallel'
import type { ResolvedViewport } from './types/metadata-interface'
import type { MetadataContext } from './types/resolvers'
import {
  MetadataBoundary,
  ViewportBoundary,
  OutletBoundary,
} from '../framework/boundary-components'

type CreateMetadataElements = (
  metadata: SelectedMetadata
) => React.ReactElement[]
type CreateViewportElements = (
  viewport: ResolvedViewport
) => React.ReactElement[]

export function createParallelMetadataComponents({
  tree,
  pathname,
  searchParams,
  metadataContext,
  interpolatedParams,
  errorType,
  serveStreamingMetadata,
  createMetadataElements,
  createViewportElements,
}: {
  tree: LoaderTree
  pathname: Promise<string>
  searchParams: Promise<ParsedUrlQuery>
  metadataContext: MetadataContext
  interpolatedParams: Params
  errorType?: MetadataErrorType | 'redirect'
  serveStreamingMetadata: boolean
  createMetadataElements: CreateMetadataElements
  createViewportElements: CreateViewportElements
}): {
  Viewport: React.ComponentType
  Metadata: React.ComponentType
  MetadataOutlet: React.ComponentType<{ tree: LoaderTree }>
} {
  async function Viewport() {
    const tags = await getMetadataResolution(
      tree,
      pathname,
      searchParams,
      interpolatedParams,
      metadataContext,
      errorType
    )
      .then(async (resolution) => {
        const selected = await resolution.selectedViewport
        if (selected.status === 'resolved' && selected.value) {
          return <>{createViewportElements(selected.value)}</>
        }
        if (
          !errorType &&
          (selected.status === 'not-found' ||
            selected.status === 'forbidden' ||
            selected.status === 'unauthorized')
        ) {
          const convention = await getViewportForBranch(
            tree,
            pathname,
            searchParams,
            selected.status,
            interpolatedParams,
            metadataContext,
            selected.parallelRouteKeys
          )
          if (convention.status === 'resolved' && convention.value) {
            return <>{createViewportElements(convention.value)}</>
          }
        }
        return null
      })
      .catch(() => {
        // We're going to throw the error from the metadata outlet so we just render null here instead
        return null
      })

    return tags
  }
  Viewport.displayName = 'Next.Viewport'

  function ViewportWrapper() {
    return (
      <ViewportBoundary>
        <Viewport />
      </ViewportBoundary>
    )
  }

  async function Metadata() {
    const tags = await getResolvedParallelMetadata(
      tree,
      pathname,
      searchParams,
      interpolatedParams,
      metadataContext,
      errorType,
      createMetadataElements
    ).catch(() => {
      // We're going to throw the error from the metadata outlet so we just render null here instead
      return null
    })

    return tags
  }
  Metadata.displayName = 'Next.Metadata'

  function MetadataWrapper() {
    // TODO: We shouldn't change what we render based on whether we are streaming or not.
    // If we aren't streaming we should just block the response until we have resolved the
    // metadata.
    if (!serveStreamingMetadata) {
      return (
        <MetadataBoundary>
          <Metadata />
        </MetadataBoundary>
      )
    }
    return (
      <div hidden>
        <MetadataBoundary>
          <Suspense name="Next.Metadata">
            <Metadata />
          </Suspense>
        </MetadataBoundary>
      </div>
    )
  }

  function MetadataOutlet({ tree: outletTree }: { tree: LoaderTree }) {
    const metadataResolution = getMetadataResolution(
      tree,
      pathname,
      searchParams,
      interpolatedParams,
      metadataContext,
      errorType
    )
    const pendingOutlet = metadataResolution.then(async (resolution) => {
      const branch = resolution.outlets.get(outletTree)
      if (!branch) return null

      const [metadata, viewport] = await Promise.all([
        branch.metadata,
        branch.viewport,
      ])
      if (metadata.error !== null) {
        throw metadata.error
      }
      if (viewport.error !== null) {
        throw viewport.error
      }
      return null
    })

    return createMetadataOutlet(pendingOutlet, serveStreamingMetadata)
  }
  MetadataOutlet.displayName = 'Next.MetadataOutlet'

  return {
    Viewport: ViewportWrapper,
    Metadata: MetadataWrapper,
    MetadataOutlet,
  }
}

function createMetadataOutlet(
  pendingOutlet: Promise<null>,
  serveStreamingMetadata: boolean
) {
  // TODO: We shouldn't change what we render based on whether we are streaming or not.
  // If we aren't streaming we should just block the response until we have resolved the
  // metadata.
  if (!serveStreamingMetadata) {
    return <OutletBoundary>{pendingOutlet}</OutletBoundary>
  }
  return (
    <OutletBoundary>
      <Suspense name="Next.MetadataOutlet">{pendingOutlet}</Suspense>
    </OutletBoundary>
  )
}

const getResolvedParallelMetadata = cache(getResolvedParallelMetadataImpl)
async function getResolvedParallelMetadataImpl(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  interpolatedParams: Params,
  metadataContext: MetadataContext,
  errorType: MetadataErrorType | 'redirect' | undefined,
  createMetadataElements: CreateMetadataElements
): Promise<React.ReactNode> {
  const resolution = await getMetadataResolution(
    tree,
    pathname,
    searchParams,
    interpolatedParams,
    metadataContext,
    errorType
  )
  const selected = await resolution.selected
  if (selected.error !== null) {
    if (
      !errorType &&
      (selected.status === 'not-found' ||
        selected.status === 'forbidden' ||
        selected.status === 'unauthorized')
    ) {
      const convention = await getMetadataForBranch(
        tree,
        pathname,
        searchParams,
        selected.status,
        interpolatedParams,
        metadataContext,
        selected.parallelRouteKeys
      )
      if (convention.error === null && convention.value) {
        return <>{createMetadataElements(convention.value)}</>
      }
    }
    return null
  }
  if (!selected.value) {
    return null
  }
  return <>{createMetadataElements(selected.value)}</>
}

const getMetadataResolution = cache(resolveMetadataResolutionImpl)
async function resolveMetadataResolutionImpl(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  interpolatedParams: Params,
  metadataContext: MetadataContext,
  errorType?: MetadataErrorType | 'redirect'
) {
  const errorConvention = errorType === 'redirect' ? undefined : errorType
  return resolveMetadataResolution(
    tree,
    pathname,
    searchParams,
    errorConvention,
    interpolatedParams,
    metadataContext
  )
}

const getMetadataForBranch = cache(resolveMetadataForBranch)
const getViewportForBranch = cache(resolveViewportForBranch)
