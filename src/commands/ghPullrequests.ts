import {ApiResponse, Client} from '@elastic/elasticsearch'
import {flags} from '@oclif/command'
import cli from 'cli-ux'
import * as loadYamlFile from 'load-yaml-file'
import * as path from 'path'

import Command from '../base'
import FetchPullrequests from '../utils/github/FetchPullrequests/index'
import chunkArray from '../utils/misc/chunkArray'

interface SearchResponse<T> {
  hits: {
    hits: Array<{
      _source: T;
    }>
  }
}

// Define the interface of the source object
interface Repository {
  name: string,
  id: string,
  pullRequests: {
    totalCount: number,
    edges: Array<{
      node: {
        id: string,
        updatedAt: string,
        __typename: string
      },
    }>,
  },
  org: Organization,
  active: boolean
}

interface Organization {
  login: string,
  id: string,
}

// Define the interface of the source object
interface Pullrequest {
  title: string,
  id: string,
  repo: Repository,
  org: Organization,
  updatedAt: string,
  createdAt: string,
  closedAt: string | null,
}

export default class GhPullrequests extends Command {
  static description = 'Fetch Pull Requests (PRs) from GitHub'

  static examples = [
    '$ github-indexer ghPullrequests',
  ]

  static flags = {
    ...Command.flags,
    help: flags.help({char: 'h'}),
  }

  /*
    The aim of this script is to fetch all pullrequests associated with active repositories.
    It does the following:
     - Fetch a list of repositories from Elasticsearch
     - Fetch updated pullrequests for each repository
     - Send back the content to Elasticsearch
   */
  async run() {
    const {flags} = this.parse(GhPullrequests)
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const {esport, eshost, esrepo} = flags
    const es_port = (esport !== undefined ? esport : userConfig.elasticsearch.port)
    const es_host = (eshost !== undefined ? eshost : userConfig.elasticsearch.host)
    const reposIndexName = (esrepo !== undefined ? esrepo : userConfig.elasticsearch.indices.repos)
    const indexPullrequestPrefix = userConfig.elasticsearch.indices.prs

    //1- Test if an index exists, if it does not, create it.
    cli.action.start('Checking if index: ' + reposIndexName + ' exists')
    const client = new Client({node: es_host + ':' + es_port})
    const healthCheck: ApiResponse = await client.cluster.health()
    if (healthCheck.body.status === 'red') {
      this.log('Elasticsearch cluster is not in an healthy state, exiting')
      this.log(healthCheck.body)
      process.exit(1)
    }
    const testIndex = await client.indices.exists({index: reposIndexName})
    if (testIndex.body === false) {
      this.error('Index: ' + reposIndexName + ' does not exists, please configure repositories first', {exit: 1})
    }
    cli.action.stop(' done')

    //2- Grab the active repositories from Elasticsearch
    cli.action.start('Grabbing the active repositories from ElasticSearch')
    let esRepos: ApiResponse<SearchResponse<Repository>> = await client.search({
      index: reposIndexName,
      body: {
        from: 0,
        size: 10000,
        query: {
          match: {
            active: {
              query: true
            }
          }
        }
      }
    })
    //console.log(esRepos.body.hits.hits);
    const activeRepos = esRepos.body.hits.hits.map(r => r._source)
    cli.action.stop(' done')

    if (activeRepos.length === 0) {
      this.error('The script could not find any active repositories. Please use ghRepos and cfRepos first.', {exit: 1})
    }
    const fetchData = new FetchPullrequests(this.log, userConfig, this.config.configDir, cli)

    this.log('Starting to grab pullrequests')
    for (let repo of activeRepos) {
      //A - Check if repo index exists, if not create
      const pullrequestsIndex = (indexPullrequestPrefix + repo.org.login + '_' + repo.name).toLocaleLowerCase()
      const testIndex = await client.indices.exists({index: pullrequestsIndex})
      if (testIndex.body === false) {
        cli.action.start('Elasticsearch Index ' + pullrequestsIndex + ' does not exist, creating')
        const mappings = await loadYamlFile('./src/schemas/pullrequests.yml')
        const settings = await loadYamlFile('./src/schemas/settings.yml')
        await client.indices.create({index: pullrequestsIndex, body: {settings, mappings}})
        cli.action.stop(' created')
      }

      //B - Find the most recent pullrequest
      let searchResult: ApiResponse<SearchResponse<Pullrequest>> = await client.search({
        index: pullrequestsIndex,
        body: {
          query: {
            match_all: {}
          },
          size: 1,
          sort: [
            {
              updatedAt: {
                order: 'desc'
              }
            }
          ]
        }
      })
      let recentPullrequest = null
      if (searchResult.body.hits.hits.length > 0) {
        recentPullrequest = searchResult.body.hits.hits[0]._source
      }

      //C - Fetch pullrequests from GitHub into a large array
      cli.action.start('Grabbing pullrequests for: ' + repo.org.login + '/' + repo.name + ' (will fetch up to ' + repo.pullRequests.totalCount + ' pullrequests)')
      let fetchedPullrequests = await fetchData.load(repo, recentPullrequest)
      cli.action.stop(' done')

      //D - Break down the pullrequests response in multiple batches
      const esPayloadChunked = await chunkArray(fetchedPullrequests, 100)
      //E- Push the results back to Elastic Search
      for (const [idx, esPayloadChunk] of esPayloadChunked.entries()) {
        cli.action.start('Submitting data to ElasticSearch into ' + pullrequestsIndex + ' (' + (idx + 1) + ' / ' + esPayloadChunked.length + ')')
        let formattedData = ''
        for (let rec of esPayloadChunk) {
          formattedData = formattedData + JSON.stringify({
            index: {
              _index: pullrequestsIndex,
              _id: (rec as Repository).id
            }
          }) + '\n' + JSON.stringify(rec) + '\n'
        }
        await client.bulk({index: pullrequestsIndex, refresh: 'wait_for', body: formattedData})
        cli.action.stop(' done')
      }
    }
  }
}
