import {ApiResponse, Client} from '@elastic/elasticsearch'
import {flags} from '@oclif/command'
import cli from 'cli-ux'
import * as loadYamlFile from 'load-yaml-file'
import * as path from 'path'

import Command from '../base'

export default class EsSchema extends Command {
  static description = 'Create an index with a mapping in Elasticsearch'

  static examples = [
    '$ github-indexer es-schema -i issues',
  ]

  static hidden = true

  static flags = {
    help: flags.help({char: 'h'}),
    mapping: flags.string({
      char: 'm',
      required: true,
      options: ['issues', 'labels', 'milestones', 'projects', 'pullrequests', 'repositories'],
      description: 'Mapping to use'
    }),
    index: flags.string({
      char: 'i',
      required: true,
      description: 'ES index to initialize the mapping with'
    }),
    // flag with no value (-f, --force)
    force: flags.boolean({char: 'f', default: false}),
  }

  static args = [{name: 'file'}]

  async run() {
    const {flags} = this.parse(EsSchema)
    const {force, mapping, index} = flags
    const userConfig = await loadYamlFile(path.join(this.config.configDir, 'config.yml'))
    const port = userConfig.elasticsearch.port
    const host = userConfig.elasticsearch.host

    // Force the user either to manually press y or to specify the force flag in the command line
    let proceed = true
    if (!force) {
      const userForce = await cli.prompt('Are you sure you want to push a new index ? It will ERASE your data (y/n)')
      proceed = (userForce === 'y')
    } else {
      proceed = true
    }
    if (proceed) {
      this.log('Testing connection to the Elasticsearch cluster')
      // tslint:disable-next-line:no-http-string
      const client = new Client({node: host + ':' + port})
      const healthCheck: ApiResponse = await client.cluster.health()

      if (healthCheck.body.status === 'red') {
        //https://nodejs.org/api/process.html#process_exit_codes
        this.log('Elastic search cluster is not in an healthy state, exiting')
        this.log(healthCheck.body)
        process.exit(1)
      }

      this.log('Testing for availability of index: ' + index)
      const testIndex = await client.indices.exists({index})
      if (testIndex.body !== false) {
        this.log('Index already exists, deleting')
        await client.indices.delete({index})
      }

      this.log('Loading the mapping from file ./src/schemas/' + mapping + '.yml')
      const mappings = await loadYamlFile('./src/schemas/' + mapping + '.yml')
      this.log('Schema configuration loaded')

      this.log('Loading the settings from file ./src/schemas/settings.yml')
      const settings = await loadYamlFile('./src/schemas/settings.yml')
      this.log(JSON.stringify(settings))

      this.log('Index settings loaded')

      this.log('Creating the index: ' + index)
      await client.indices.create({index, body: {settings, mappings}})
      this.log('Index created: ' + index)
    } else {
      this.log('Command cancelled')
    }
  }
}
