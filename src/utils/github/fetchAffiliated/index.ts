import * as _ from 'lodash';
import fetch from 'node-fetch';
import ApolloClient from 'apollo-client';
import { HttpLink } from 'apollo-link-http';
import { ApolloLink, concat } from 'apollo-link';
import { InMemoryCache } from 'apollo-cache-inmemory';
import gql from 'graphql-tag';

import { readFileSync } from 'fs';
import calculateQueryIncrement from '../utils/calculateQueryIncrement.ts';
import cli from "cli-ux";

export default class fetchAffiliated {
  constructor (log: any, userConfig: object, cli: object) {
    this.githubToken = userConfig.github.token
    this.githubLogin = userConfig.github.login

    this.log = log;
    this.cli = cli;
    this.fetchedRepos = [];
    this.githubOrgs = [];
    this.totalReposCount = 0;
    this.orgReposCount = {};
    this.state = {};
    this.errorRetry = 0;
    this.getOrgs = readFileSync('./src/utils/github/graphql/getOrgs.graphql','utf8');
    this.getRepos = readFileSync('./src/utils/github/graphql/getRepos.graphql','utf8');
    this.getUserRepos = readFileSync('./src/utils/github/graphql/getUserRepos.graphql','utf8');

    const httpLink = new HttpLink({ uri: 'https://api.github.com/graphql' , fetch: fetch});
    const cache = new InMemoryCache()
    //const cache = new InMemoryCache().restore(window.__APOLLO_STATE__);

    const authMiddleware = new ApolloLink((operation: any, forward: any) => {
      // add the authorization to the headers
      operation.setContext({
        headers: {
          authorization: this.githubToken ? `Bearer ${this.githubToken}` : "",
        }
      });
      return forward(operation).map(response => {
        if (response.errors !== undefined && response.errors.length > 0) {
          response.data.errors = response.errors;
        }
        return response;
      });
    });

    this.client = new ApolloClient({
      link: concat(authMiddleware, httpLink),
      //link: authLink.concat(link),
      cache: cache,
    });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  };

  async load() {
    this.log('Started load');

    cli.action.start('Searching for affiliated organizations')
    await this.getOrgsPagination(null, 5);
    cli.action.stop(this.githubOrgs.length + ' found')

    //this.log(this.githubOrgs);

    this.log('Initiate Organizations Repositories load');
    for (let OrgObj of this.githubOrgs) {
      if (OrgObj !== null) {
        cli.action.start('Loading repositories for organizations: ' + OrgObj.login)
        await this.getReposPagination(null, 5, OrgObj, 'org');
        cli.action.stop(' completed')

      }
    }

    this.log('Initiate Users own Repositories load');
    await this.getReposPagination(null, 20, {login: this.githubLogin}, 'user');
    this.log('Organizations Repositories loaded: ' + this.totalReposCount);

    return this.fetchedRepos
  }

  async getOrgsPagination(cursor, increment) {
    let data = await this.client.query({
      query: gql`${this.getOrgs}`,
      variables: {repo_cursor: cursor, increment: increment},
      fetchPolicy: 'no-cache',
      errorPolicy: 'ignore',
    });

    if (data.data !== undefined && data.data.errors !== undefined && data.data.errors.length > 0) {
      data.data.errors.forEach((error) => {
        this.log(error.message);
      });
    }

    //this.log('GraphQL Response:', data);
    //updateChip(data.data.rateLimit);
    let lastCursor = await this.loadOrganizations(data);
    let queryIncrement = calculateQueryIncrement(this.githubOrgs.length, data.data.viewer.organizations.totalCount);
    if (queryIncrement > 0) {
      await this.getOrgsPagination(lastCursor, queryIncrement);
    }

  };

  async loadOrganizations(data: any) {
    let lastCursor = null;
    for (var currentOrg of data.data.viewer.organizations.edges) {
      this.githubOrgs.push(currentOrg.node);
      lastCursor = currentOrg.cursor;
    }
    return lastCursor;
  };

  async getReposPagination(cursor: any, increment: any, OrgObj: any, type: any) {
    if (this.errorRetry <= 3) {
      if (OrgObj !== null) {
        let data = {};
        let repositories = {};
        await this.sleep(1000); // Wait 2s between requests to avoid hitting GitHub API rate limit => https://developer.github.com/v3/guides/best-practices-for-integrators/
        try {
          if (type === 'org') {
            data = await this.client.query({
              query: gql`${this.getRepos}`,
              variables: {repo_cursor: cursor, increment: increment, org_name: OrgObj.login},
              fetchPolicy: 'no-cache',
            });
            repositories = data.data.viewer.organization.repositories;
          } else {
            data = await this.client.query({
              query: gql`${this.getUserRepos}`,
              variables: {repo_cursor: cursor, increment: increment, login: OrgObj.login},
              fetchPolicy: 'no-cache',
            });
            OrgObj = data.data.user;
            repositories = data.data.viewer.repositories;
          }
        }
        catch (error) {
          this.log(error);
        }
        if (data.data !== undefined && data.data.errors !== undefined && data.data.errors.length > 0) {
          data.data.errors.forEach((error) => {
            this.log(error.message);
          });
        }
//        this.log(data);
//        this.log(OrgObj);
        if (data.data !== undefined && data.data !== null) {
          this.errorRetry = 0;
          if (this.orgReposCount[OrgObj.id] === undefined) {
            this.orgReposCount[OrgObj.id] = 0;
          }
          //updateChip(data.data.rateLimit);
          let lastCursor = await this.loadRepositories(repositories, OrgObj);
          let queryIncrement = calculateQueryIncrement(this.orgReposCount[OrgObj.id], repositories.totalCount);
          this.log('Org: ' + OrgObj.login + ' -> Fetched Count / Remote Count / Query Increment: ' + this.orgReposCount[OrgObj.id] + ' / ' + repositories.totalCount + ' / ' + queryIncrement);
          if (queryIncrement > 0) {
            await this.getReposPagination(lastCursor, queryIncrement, OrgObj, type);
          }
        } else {
          this.errorRetry = this.errorRetry + 1;
          this.log('Error loading content, current count: ' + this.errorRetry)
          await this.getReposPagination(cursor, increment, OrgObj, type);
        }
      }
    } else {
      this.log('Got too many load errors, stopping');
      process.exit(1)
    }
  }

  async loadRepositories(repositories, OrgObj) {
//    this.log('Loading from ' + OrgObj.login + ' organization');

    let lastCursor = null;
    for (var currentRepo of repositories.edges) {
      let repoObj = JSON.parse(JSON.stringify(currentRepo.node)); //TODO - Replace this with something better to copy object ?
      repoObj['org'] = OrgObj;

      const existingRepo = _.find(this.fetchedRepos, {'id': repoObj.id})
      //There are occurences where duplicate repos might be fetched (from the organizations, then from the user).
      //Skipping if coming from the user, giving higher priority to Organixation
      if (existingRepo!== undefined && (existingRepo.org.__typename === "Organization" && OrgObj.__typename === "User")) {
        this.log('This repo already exists as part of an organization, skipping...');
      } else {
        this.fetchedRepos.push(repoObj);
      }
      lastCursor = currentRepo.cursor;
    }
    this.orgReposCount[OrgObj.id] = this.orgReposCount[OrgObj.id] + Object.entries(repositories.edges).length;
    this.totalReposCount = this.totalReposCount + Object.entries(repositories.edges).length;
    //this.log('Fetched a total of ' + this.totalReposCount + ' repositories');

    return lastCursor;
  };

  render() {
    return null;
  }

}
