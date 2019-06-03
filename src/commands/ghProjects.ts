import {ApiResponse, Client} from '@elastic/elasticsearch'
import {Command, flags} from '@oclif/command'
import cli from 'cli-ux'
import * as loadYamlFile from 'load-yaml-file'
import * as path from 'path'

import FetchProjects from '../utils/github/fetchProjects/index'
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
  url: string,
  id: string,
  active: boolean,
  projects: {
    totalCount: number,
    __typename: string
  },
  org: Organization,
}

interface Project {
  id: string,
  repo: Repository,
  org: Organization,
  title: string,
  updatedAt: string,
  createdAt: string,
  closedAt: string | null,
}

interface Organization {
  login: string,
  id: string,
}

export default class GhProjects extends Command {
  static description = 'Fetch projects from GitHub'

  static examples = [
    '$ github-indexer ghIssues',
  ]

  static flags = {
    help: flags.help({char: 'h'}),
  }

  /*
    The aim of this script is to fetch all projects associated with active repositories.
    It does the following:
     - Fetch a list of repositories from Elasticsearch
     - Fetch updated projects for each repository
     - Send back the content to Elasticsearch
   */
  async run() {
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const es_port = userConfig.elasticsearch.port
    const es_host = userConfig.elasticsearch.host
    const reposIndexName = userConfig.elasticsearch.indices.repos
    const indexProjectPrefix = userConfig.elasticsearch.indices.projects

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
    const fetchData = new FetchProjects(this.log, userConfig, this.config.configDir, cli)
    const orgsFetched: Array<string> = []
    this.log('Starting to grab projects')
    for (let repo of activeRepos) {
      //A - First, fetch projects at the organization level
      //A.1 - Grab org-level project (if not already fetched)
      if (!orgsFetched.includes(repo.org.login)) {
        const orgProjectsIndex = (indexProjectPrefix + repo.org.login).toLocaleLowerCase()
        const testOrgProjectIndex = await client.indices.exists({index: orgProjectsIndex})
        if (testOrgProjectIndex.body === false) {
          cli.action.start('Elasticsearch Index ' + orgProjectsIndex + ' does not exist, creating')
          const mappings = await loadYamlFile('./src/schemas/projects.yml')
          const settings = await loadYamlFile('./src/schemas/settings.yml')
          await client.indices.create({index: orgProjectsIndex, body: {settings, mappings}})
          cli.action.stop(' created')
        }

        //A.2 - Find the most recent project
        let searchResult: ApiResponse<SearchResponse<Project>> = await client.search({
          index: orgProjectsIndex,
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
        let recentOrgProject = null
        if (searchResult.body.hits.hits.length > 0) {
          recentOrgProject = searchResult.body.hits.hits[0]._source
        }

        //A.3 - Fetch the org-level projects
        cli.action.start('Grabbing org-level projects from: ' + repo.org.login)
        let fetchedOrgProjects = await fetchData.loadOrgProjects(repo.org, recentOrgProject)
        orgsFetched.push(repo.org.login)
        cli.action.stop(' done')

        //A.4 - Break down the issues response in multiple batches
        const esPayloadChunked = await chunkArray(fetchedOrgProjects, 100)
        //A.5- Push the results back to Elastic Search
        for (const [idx, esPayloadChunk] of esPayloadChunked.entries()) {
          cli.action.start('Submitting data to ElasticSearch into ' + orgProjectsIndex + ' (' + (idx + 1) + ' / ' + esPayloadChunked.length + ')')
          let formattedData = ''
          for (let rec of esPayloadChunk) {
            formattedData = formattedData + JSON.stringify({
              index: {
                _index: orgProjectsIndex,
                _id: (rec as Repository).id
              }
            }) + '\n' + JSON.stringify(rec) + '\n'
          }
          await client.bulk({index: orgProjectsIndex, refresh: 'wait_for', body: formattedData})
          cli.action.stop(' done')
        }
      }

      // B - Second, fetch projects at the repository level
      // B.1 - Test if index exists, if not, create
      const projectsIndex = (indexProjectPrefix + repo.org.login + '_' + repo.name).toLocaleLowerCase()
      const testIndex = await client.indices.exists({index: projectsIndex})
      if (testIndex.body === false) {
        cli.action.start('Elasticsearch Index ' + projectsIndex + ' does not exist, creating')
        const mappings = await loadYamlFile('./src/schemas/projects.yml')
        const settings = await loadYamlFile('./src/schemas/settings.yml')
        await client.indices.create({index: projectsIndex, body: {settings, mappings}})
        cli.action.stop(' created')
      }

      //B.2 - Find the most recent project
      let searchResult: ApiResponse<SearchResponse<Project>> = await client.search({
        index: projectsIndex,
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
      let recentProject = null
      if (searchResult.body.hits.hits.length > 0) {
        recentProject = searchResult.body.hits.hits[0]._source
      }

      //B.3 - Fetch projects from GitHub into a large array
      cli.action.start('Grabbing projects for: ' + repo.org.login + '/' + repo.name + ' (will fetch up to ' + repo.projects.totalCount + ' projects)')
      let fetchedIssues = await fetchData.load(repo, recentProject)
      cli.action.stop(' done')

      //B.4 - Break down the issues response in multiple batches
      const esPayloadChunked = await chunkArray(fetchedIssues, 100)
      //B.5- Push the results back to Elastic Search
      for (const [idx, esPayloadChunk] of esPayloadChunked.entries()) {
        cli.action.start('Submitting data to ElasticSearch into ' + projectsIndex + ' (' + (idx + 1) + ' / ' + esPayloadChunked.length + ')')
        let formattedData = ''
        for (let rec of esPayloadChunk) {
          formattedData = formattedData + JSON.stringify({
            index: {
              _index: projectsIndex,
              _id: (rec as Repository).id
            }
          }) + '\n' + JSON.stringify(rec) + '\n'
        }
        await client.bulk({index: projectsIndex, refresh: 'wait_for', body: formattedData})
        cli.action.stop(' done')
      }
    }
  }
}
