import React, { Suspense, cache } from 'react'
import type { ParsedUrlQuery } from 'querystring'
import type { Params } from '../../server/request/params'
import type { LoaderTree } from '../../server/lib/app-dir-module'
import {
  type MetadataErrorType,
  type SelectedMetadata,
  createSelectedMetadata,
  resolveMetadata,
  resolveViewport,
} from './resolve-metadata'
import type { ResolvedViewport } from './types/metadata-interface'
import { isHTTPAccessFallbackError } from '../../client/components/http-access-fallback/http-access-fallback'
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

export function createLegacyMetadataComponents({
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
    return getResolvedViewport(
      tree,
      searchParams,
      interpolatedParams,
      errorType,
      createViewportElements
    ).catch((viewportErr) => {
      if (!errorType && isHTTPAccessFallbackError(viewportErr)) {
        return getNotFoundViewport(
          tree,
          searchParams,
          interpolatedParams,
          createViewportElements
        ).catch(() => null)
      }
      return null
    })
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
    return getResolvedMetadata(
      tree,
      pathname,
      searchParams,
      interpolatedParams,
      metadataContext,
      errorType,
      createMetadataElements
    ).catch((metadataErr) => {
      if (!errorType && isHTTPAccessFallbackError(metadataErr)) {
        return getNotFoundMetadata(
          tree,
          pathname,
          searchParams,
          interpolatedParams,
          metadataContext,
          createMetadataElements
        ).catch(() => null)
      }
      return null
    })
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

  function MetadataOutlet() {
    const pendingOutlet = Promise.all([
      getResolvedMetadata(
        tree,
        pathname,
        searchParams,
        interpolatedParams,
        metadataContext,
        errorType,
        createMetadataElements
      ),
      getResolvedViewport(
        tree,
        searchParams,
        interpolatedParams,
        errorType,
        createViewportElements
      ),
    ]).then(() => null)

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

const getResolvedMetadata = cache(getResolvedMetadataImpl)
async function getResolvedMetadataImpl(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  interpolatedParams: Params,
  metadataContext: MetadataContext,
  errorType: MetadataErrorType | 'redirect' | undefined,
  createMetadataElements: CreateMetadataElements
): Promise<React.ReactNode> {
  return renderMetadata(
    tree,
    pathname,
    searchParams,
    interpolatedParams,
    metadataContext,
    errorType === 'redirect' ? undefined : errorType,
    createMetadataElements
  )
}

const getNotFoundMetadata = cache(getNotFoundMetadataImpl)
async function getNotFoundMetadataImpl(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  interpolatedParams: Params,
  metadataContext: MetadataContext,
  createMetadataElements: CreateMetadataElements
): Promise<React.ReactNode> {
  return renderMetadata(
    tree,
    pathname,
    searchParams,
    interpolatedParams,
    metadataContext,
    'not-found',
    createMetadataElements
  )
}

const getResolvedViewport = cache(getResolvedViewportImpl)
async function getResolvedViewportImpl(
  tree: LoaderTree,
  searchParams: Promise<ParsedUrlQuery>,
  interpolatedParams: Params,
  errorType: MetadataErrorType | 'redirect' | undefined,
  createViewportElements: CreateViewportElements
): Promise<React.ReactNode> {
  return renderViewport(
    tree,
    searchParams,
    interpolatedParams,
    errorType === 'redirect' ? undefined : errorType,
    createViewportElements
  )
}

const getNotFoundViewport = cache(getNotFoundViewportImpl)
async function getNotFoundViewportImpl(
  tree: LoaderTree,
  searchParams: Promise<ParsedUrlQuery>,
  interpolatedParams: Params,
  createViewportElements: CreateViewportElements
): Promise<React.ReactNode> {
  return renderViewport(
    tree,
    searchParams,
    interpolatedParams,
    'not-found',
    createViewportElements
  )
}

async function renderMetadata(
  tree: LoaderTree,
  pathname: Promise<string>,
  searchParams: Promise<ParsedUrlQuery>,
  interpolatedParams: Params,
  metadataContext: MetadataContext,
  errorConvention: MetadataErrorType | undefined,
  createMetadataElements: CreateMetadataElements
) {
  const resolvedMetadata = await resolveMetadata(
    tree,
    pathname,
    searchParams,
    errorConvention,
    interpolatedParams,
    metadataContext
  )
  return <>{createMetadataElements(createSelectedMetadata(resolvedMetadata))}</>
}

async function renderViewport(
  tree: LoaderTree,
  searchParams: Promise<ParsedUrlQuery>,
  interpolatedParams: Params,
  errorConvention: MetadataErrorType | undefined,
  createViewportElements: CreateViewportElements
) {
  const resolvedViewport = await resolveViewport(
    tree,
    searchParams,
    errorConvention,
    interpolatedParams
  )
  return <>{createViewportElements(resolvedViewport)}</>
}
