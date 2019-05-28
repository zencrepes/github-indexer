import {ApiResponse, Client} from '@elastic/elasticsearch'
import {Command, flags} from '@oclif/command'
import cli from 'cli-ux'
import * as loadYamlFile from 'load-yaml-file'
import * as path from 'path'

import FetchIssues from '../utils/github/fetchIssues/index'

export default class GhIssues extends Command {
  static description = 'Fetch issues from GitHub'

  static examples = [
    '$ github-indexer ghIssues',
  ]

  static flags = {
    help: flags.help({char: 'h'}),
  }

  async run() {
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const es_port = userConfig.elasticsearch.port
    const es_host = userConfig.elasticsearch.host
    const reposIndexName = userConfig.elasticsearch.indices.repos
    const indexIssuePrefix = userConfig.elasticsearch.indices.issues

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
      cli.action.start('Elasticsearch Index gh_repos does not exist, creating')
      const mappings = await loadYamlFile('./src/schemas/repositories.yml')
      const settings = await loadYamlFile('./src/schemas/settings.yml')
      await client.indices.create({index: reposIndexName, body: {settings, mappings}})
    }
    cli.action.stop(' done')

    //2- Grab the active repositories from Elasticsearch
    cli.action.start('Grabbing the active repositories from ElasticSearch')
    let esRepos = await client.search({
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
    const fetchData = new FetchIssues(this.log, this.error, userConfig, cli)

    this.log('Starting to grab issues')
    for (let repo of activeRepos) {
      //A - Check if repo index exists, if not create
      const issuesIndex = (indexIssuePrefix + '_' + repo.org.login + '_' + repo.name).toLocaleLowerCase()
      const testIndex = await client.indices.exists({index: issuesIndex})
      if (testIndex.body === false) {
        cli.action.start('Elasticsearch Index ' + issuesIndex + ' does not exist, creating')
        const mappings = await loadYamlFile('./src/schemas/issues.yml')
        const settings = await loadYamlFile('./src/schemas/settings.yml')
        await client.indices.create({index: issuesIndex, body: {settings, mappings}})
        cli.action.stop(' created')
      }

      //B - Find the most recent issue
      let searchResult = await client.search({
        index: issuesIndex,
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
      let recentIssue = null
      if (searchResult.body.hits.hits[0] !== undefined) {
        recentIssue = searchResult.body.hits.hits[0]._source
      }

      //C - Fetch issues from GitHub into a large array
      cli.action.start('Grabbing issues for: ' + repo.org.login + '/' + repo.name + ' (will fetch up to ' + repo.issues.totalCount + ' issues)')
      let fetchedIssues = await fetchData.load(repo, recentIssue)
      cli.action.stop(' done')

      //D - Break down the issues response in multiple batches
      const esPayloadChunked = await this.chunkArray(fetchedIssues, 100)
      //E- Push the results back to Elastic Search
      for (const [idx, esPayloadChunk] of esPayloadChunked.entries()) {
        cli.action.start('Submitting data to ElasticSearch into ' + issuesIndex + ' (' + parseInt(idx + 1, 10) + ' / ' + esPayloadChunked.length + ')')
        let formattedData = ''
        for (let rec of esPayloadChunk) {
          formattedData = formattedData + JSON.stringify({
            index: {
              _index: issuesIndex,
              _id: rec.id
            }
          }) + '\n' + JSON.stringify(rec) + '\n'
        }
        await client.bulk({index: issuesIndex, refresh: 'wait_for', body: formattedData})
        cli.action.stop(' done')
      }
    }
  }

  //https://ourcodeworld.com/articles/read/278/how-to-split-an-array-into-chunks-of-the-same-size-easily-in-javascript
  async chunkArray(srcArray, chunkSize) {
    let idx = 0
    let tmpArray = []
    for (idx = 0; idx < srcArray.length; idx += chunkSize) {
      tmpArray.push(srcArray.slice(idx, idx + chunkSize))
    }
    return tmpArray
  }
}
