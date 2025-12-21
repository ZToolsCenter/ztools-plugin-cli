#!/usr/bin/env node
import { red, yellow } from 'kolorist'
import minimist from 'minimist'
import { create } from './cli.js'
import { publish } from './publish.js'

const args = minimist(process.argv.slice(2))
const command = args._[0]

async function main(): Promise<void> {
  if (command === 'create') {
    const projectName = args._[1]
    await create(projectName)
  } else if (command === 'publish') {
    await publish()
  } else {
    console.log(yellow('\nUsage: ztools <command> [options]\n'))
    console.log('Commands:')
    console.log('  create <project-name>  Create a new plugin project')
    console.log('  publish                Publish plugin to ZTools-plugins repository\n')
    console.log('Examples:')
    console.log('  ztools create my-plugin')
    console.log('  ztools publish\n')
  }
}

main().catch((error) => {
  console.error(red(`\nError: ${error.message}\n`))
  process.exit(1)
})
