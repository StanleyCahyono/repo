/**
 * Server entry point for links. Client components must import the pure URL builders from
 * '@/lib/providers/links/builders' instead: this index also exports the link checker, which uses the server-only
 * HTTP client.
 */
export * from './builders'
export { checkLink, embeddableFrom, type CheckLinkOptions } from './check'
