import {ApiResponse, Client} from '@elastic/elasticsearch'
import {Command, flags} from '@oclif/command'
import cli from 'cli-ux'
import * as fs from 'fs'
import * as jsYaml from 'js-yaml'
import * as loadYamlFile from 'load-yaml-file'
import * as _ from 'lodash'
import * as path from 'path'

import FetchAffiliated from '../utils/github/fetchAffiliated/index'
import FetchOrg from '../utils/github/fetchOrg/index'
import FetchRepo from '../utils/github/fetchRepo/index'

export default class GithubRepo extends Command {
  static description = 'Fetch repositories from GitHub'

  static examples = [
    '$ github-indexer githubRepo -g affiliated',
    '$ github-indexer githubRepo -g org -o jetbrains',
    '$ github-indexer githubRepo -g repo -o microsoft -r vscode',
  ]

  static flags = {
    help: flags.help({char: 'h'}),
    grab: flags.string({
      char: 'g',
      required: true,
      options: ['affiliated', 'org', 'repo'],
      description: 'Select how to fetch repositories'
    }),
    org: flags.string({
      char: 'o',
      required: false,
      description: 'GitHub organization login'
    }),
    repo: flags.string({
      char: 'r',
      required: false,
      description: 'GitHub repository name'
    }),
    // flag with no value (-f, --force)
    force: flags.boolean({char: 'f', default: false}),
  }

  async run() {
    const {flags} = this.parse(GithubRepo)
    const {grab, org, repo} = flags
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const es_port = userConfig.elasticsearch.port
    const es_host = userConfig.elasticsearch.host

    //1- Grab the repositories from GitHub
    let fetchedRepos = []
    if (grab === 'affiliated') {
      this.log('Starting to fetch data from affiliated organizations')
      const fetchData = new FetchAffiliated(this.log, this.error, userConfig, cli)
      fetchedRepos = await fetchData.load()
    } else if (grab === 'org' && org !== undefined) {
      this.log('Starting to fetch data from org: ' + org)
      const fetchData = new FetchOrg(this.log, this.error, userConfig, cli)
      fetchedRepos = await fetchData.load(org)
    } else if (grab === 'repo' && org !== undefined && repo !== undefined) {
      this.log('Starting to fetch data from repo: ' + org + '/' + repo)
      const fetchData = new FetchRepo(this.log, this.error, userConfig, cli)
      fetchedRepos = await fetchData.load(org, repo)
    }
    const reposIndexName = 'gh_repos'

    //2- Test if an index exists, if it does not, create it.
    cli.action.start('Checking if repository: ' + reposIndexName + ' exists')
    const client = new Client({node: es_host + ':' + es_port})
    const healthCheck: ApiResponse = await client.cluster.health()
    if (healthCheck.body.status === 'red') {
      this.log('Elastic search cluster is not in an healthy state, exiting')
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

    cli.action.start('Grabbing data from ElasticSearch and merging with new data')
    //3- Grab the repositories data from ElasticSearch
    let esRepos = await client.search({
      index: reposIndexName,
      body: {
        from: 0,
        size: 10000,
        query: {
          match_all: {}
        }
      }
    })

    //4- Loop through the newly grabbed data and see if there is a corresponding result in ES
    let esPayload = []
    fetchedRepos.map((repo: object) => {
      const existingRepo = _.find(esRepos.body.hits.hits, {id: repo.id})
      const updatedRepo = {...repo}
      if (existingRepo !== undefined) {
        //If the repo exist, we are only looking for the active flag
        updatedRepo.active = existingRepo.active
      } else {
        updatedRepo.active = false
      }
      //If submitting only one repository, assumption is that it should be active.
      if (grab === 'repo') {
        this.log('Activating repository: ' + repo.org.login + '/' + repo.name)
        updatedRepo.active = true
      }
      esPayload.push(updatedRepo)
    })
    cli.action.stop(' done')
    this.log('About to submit (create or update) data about ' + esPayload.length + ' repo(s) to Elasticsearch')

    //Split the array in chunks of 100
    const esPayloadChunked = await this.chunkArray(esPayload, 100)
    //5- Push the results back to Elastic Search
    for (const [idx, esPayloadChunk] of esPayloadChunked.entries()) {
      cli.action.start('Submitting data to ElasticSearch (' + parseInt(idx + 1, 10) + ' / ' + esPayload.length + ')')
      let formattedData = ''
      for (let rec of esPayloadChunk) {
        formattedData = formattedData + JSON.stringify({
          index: {
            _index: reposIndexName,
            _id: rec.id
          }
        }) + '\n' + JSON.stringify(rec) + '\n'
      }
      await client.bulk({index: reposIndexName, refresh: 'wait_for', body: formattedData})
      cli.action.stop(' done')
    }

    //6- Update the configuration by re-downloading all data from ElasticSearch to create the configuration file
    cli.action.start('Refreshing the repositories configuration file')
    esRepos = await client.search({
      index: reposIndexName,
      body: {
        from: 0,
        size: 10000,
        query: {
          match_all: {}
        }
      }
    })

    const esResults = _.sortBy(esRepos.body.hits.hits, [function (o) { if (o.org !== null) { return o.user } else { return '' } }])

    this.log('')
    this.log('All available repositories:')
    cli.table(esResults, {
      name: {
        get: row => (row._source.org.login + '/' + row._source.name)
      },
      active: {
        get: row => row._source.active
      },
    }, {
      printLine: this.log,
    })
    this.log('')
    const configArray = esResults.map(repo => {
      return {
        [repo._source.org.login + '/' + repo._source.name]: repo._source.active
      }
    })
    fs.writeFileSync(path.join(this.config.configDir, 'repositories.yml'), jsYaml.safeDump(configArray))
    cli.action.stop(' done')
    this.log('You can enable/disable repositories in: ' + path.join(this.config.configDir, 'repositories.yml'))
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
