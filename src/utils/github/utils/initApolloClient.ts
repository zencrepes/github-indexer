import {InMemoryCache} from 'apollo-cache-inmemory'
import ApolloClient from 'apollo-client'
import {ApolloLink, concat} from 'apollo-link'
import {HttpLink} from 'apollo-link-http'
import fetch from 'node-fetch'

async function initApolloClient(githubToken: string) {
  const httpLink = new HttpLink({uri: 'https://api.github.com/graphql', fetch: fetch as any})
  const cache = new InMemoryCache()
  //const cache = new InMemoryCache().restore(window.__APOLLO_STATE__)

  const authMiddleware = new ApolloLink((operation: any, forward: any) => {
    // add the authorization to the headers
    operation.setContext({
      headers: {
        authorization: githubToken ? `Bearer ${githubToken}` : '',
      }
    })
    return forward(operation).map((response: {errors: Array<object>, data: {errors: Array<object>}} | undefined) => {
      if (response !== undefined && response.errors.length > 0) {
        response.data.errors = response.errors
      }
      return response
    })
  })

  const client = await new ApolloClient({
    link: concat(authMiddleware, httpLink),
    //link: authLink.concat(link),
    cache,
  })
  return client
}
export default initApolloClient
