#!/usr/bin/env node
import { red, yellow } from 'kolorist'
import minimist from 'minimist'
import { create } from './cli.js'

const args = minimist(process.argv.slice(2))
const command = args._[0]

async function main() {
  if (command === 'create') {
    const projectName = args._[1]
    await create(projectName)
  } else {
    console.log(yellow('\nUsage: ztools create <project-name>\n'))
    console.log('Examples:')
    console.log('  ztools create my-plugin')
    console.log('  ztools create my-awesome-plugin\n')
  }
}

main().catch((error) => {
  console.error(red(`\nError: ${error.message}\n`))
  process.exit(1)
})
