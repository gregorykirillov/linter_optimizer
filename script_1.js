const fs = require('fs')
const glob = require('glob')
const stylelint = require('stylelint')

const ignoreFile = '.stylelintignore'
const ignorePatterns = fs.readFileSync(ignoreFile, 'utf-8').split(/\r?\n/)

const deleteLine = (line) => {
  const content = fs.readFileSync(ignoreFile, 'utf-8')
  const newContent = content.split(/\r?\n/).filter((l) => l !== line).join('\n')

  fs.writeFileSync(ignoreFile, newContent)
}

const flattenDirectory = (paths) => {
  return paths.map(path => {
    if (fs.statSync(path).isDirectory()) return flattenDirectory(glob.sync(`${paths}/*`))

    return path
  }).flat()
}

const checkIsCorrectPath = async (pattern) => {
  const result = await stylelint.lint({
    files: pattern,
    configFile: '.stylelintrc.json',
    ignorePath: 'emptyStyleLintIgnoreFile'
  })

  return !result.errored
}

const getPathsToDelete = async (pattern) => {
  const pathsToDelete = new Set()

  const isCorrectPath = await checkIsCorrectPath(pattern)
  if (isCorrectPath) pathsToDelete.add(pattern)

  return pathsToDelete
}

const checkIgnorePattern = async (pattern) => {
  const isDirectory = pattern.slice(-1) === '/'
  const newPattern = isDirectory ? `${pattern}*` : pattern
  const foundFilesPaths = flattenDirectory(glob.sync(newPattern))

  if (foundFilesPaths.length === 0) {
    deleteLine(pattern)
    return
  }

  const pathsToDelete = await getPathsToDelete(pattern)
  pathsToDelete.forEach((file) => deleteLine(file.replace(/\\/g, '/')))
}

ignorePatterns.forEach(async (pattern) => {
  checkIgnorePattern(pattern)
})
