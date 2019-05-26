import {Command, flags} from '@oclif/command'
import cli from 'cli-ux'

export default class EsSchema extends Command {
  static description = 'Create (or update) a schema in Elasticsearch'

  static examples = [
    `$ github-indexer es-schema -i issues`,
  ];

  static flags = {
    help: flags.help({char: 'h'}),
    index: flags.string({
      char: 'i',
      required: true,
      options: ['issues', 'labels', 'milestones', 'projects', 'pullrequests', 'repositories'],
      description: 'ES index to initialize'
    }),
    host: flags.string({
      char: 's',
      required: false,
      default: '127.0.0.1',
      description: 'ES host'
    }),
    port: flags.string({
      char: 'p',
      required: false,
      default: '9200',
      description: 'ES port'
    }),
    // flag with no value (-f, --force)
    force: flags.boolean({char: 'f', default: false}),
  };

  static args = [{name: 'file'}];

  async run() {
    const {args, flags} = this.parse(EsSchema);
    const force = flags.force;

    // Force the user either to manually press y or to specify the force flag in the command line
    let proceed = true;
    if (!force) {
      const userForce = await cli.prompt('Are you sure you want to push a new index ? It will ERASE your data (y/n)');
      proceed = (userForce === 'y' ? true : false);
    } else {
      proceed = true;
    }
    if (proceed) {
      const mapping = flags.index || 'world'

      this.log(`Importing yml mapping file ${mapping}.yml`);
      
      this.log(`Parsing mapping file`);
      this.log(`Submitting mapping file`);

      const name = flags.index || 'world'
      this.log(`hello ${name} from ./src/commands/hello.ts`)
      if (args.file && flags.force) {
        this.log(`you input --force and --file: ${args.file}`)
      }
    } else {
      this.log(`Command cancelled`)
    }
  }
}
