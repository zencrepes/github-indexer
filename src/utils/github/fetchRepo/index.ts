import {InMemoryCache} from 'apollo-cache-inmemory'
import ApolloClient from 'apollo-client'
import {ApolloLink, concat} from 'apollo-link'
import {HttpLink} from 'apollo-link-http'
import cli from 'cli-ux'
import {readFileSync} from 'fs'
import fetch from 'node-fetch'

import graphqlQuery from '../utils/graphqlQuery'

export default class FetchRepo {
  constructor(log: object, error: object, userConfig: object, cli: object) {
    this.githubToken = userConfig.github.token
    this.githubLogin = userConfig.github.login
    this.maxQueryIncrement = userConfig.fetch.max_nodes

    this.log = log
    this.error = error
    this.cli = cli
    this.fetchedRepos = []
    this.githubOrgs = []
    this.totalReposCount = 0
    this.state = {}
    this.errorRetry = 0
    this.getSingleRepo = readFileSync('./src/utils/github/graphql/getSingleRepo.graphql', 'utf8')

    this.rateLimit = {
      limit: 5000,
      cost: 1,
      remaining: 5000,
      resetAt: null
    }

    const httpLink = new HttpLink({uri: 'https://api.github.com/graphql', fetch})
    const cache = new InMemoryCache()
    //const cache = new InMemoryCache().restore(window.__APOLLO_STATE__)

    const authMiddleware = new ApolloLink((operation: any, forward: any) => {
      // add the authorization to the headers
      operation.setContext({
        headers: {
          authorization: this.githubToken ? `Bearer ${this.githubToken}` : '',
        }
      })
      return forward(operation).map(response => {
        if (response.errors !== undefined && response.errors.length > 0) {
          response.data.errors = response.errors
        }
        return response
      })
    })

    this.client = new ApolloClient({
      link: concat(authMiddleware, httpLink),
      //link: authLink.concat(link),
      cache,
    })
  }

  public async load(login, repo) {
    this.log('Started load')

    cli.action.start('Loading repository: ' + login + '/' + repo)
    const data = await graphqlQuery(
      this.client,
      this.getSingleRepo,
      {org_name: login, repo_name: repo},
      this.rateLimit,
      this.log
    )
    if (data.data.repository !== null) {
      let repoObj = JSON.parse(JSON.stringify(data.data.repository)) //TODO - Replace this with something better to copy object ?
      repoObj.org = {
        login: data.data.repository.owner.login,
        name: data.data.repository.owner.login,
        id: data.data.repository.owner.id,
        url: data.data.repository.owner.url,
      }
      this.fetchedRepos.push(repoObj)
    } else {
      this.log('ERROR: Either this repository does not exist, or you do not have the necessary permissions')
    }

    cli.action.stop(' completed')
    return this.fetchedRepos
  }
}
