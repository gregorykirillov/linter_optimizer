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
  const isGlobalIgnore = () => pattern.slice(0, 1) === '*'

  const result = await stylelint.lint({
    files: isGlobalIgnore() ? `**/${pattern}` : pattern,
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

const getLintCorrectFilePaths = async (foundFilesPaths, pattern, toBeDeletedPaths) => {
  if (foundFilesPaths.length === 0) {
    return [...toBeDeletedPaths, pattern]
  }

  const res = await getPathsToDelete(pattern)
  return res.values()
}

const removeCorrelatedPatterns = (patternFilesMap) => {
  if (patternFilesMap.size === 0) return []

  const pathMap = new Map()
  for (const [pattern, paths] of patternFilesMap) {
    for (const path of paths) {
      if (!pathMap.has(path)) pathMap.set(path, [])
      pathMap.get(path).push(pattern)
    }
  }

  const clearedPatterns = []
  const correlatedPaths = []

  for (const [pattern, paths] of patternFilesMap) {
    const isCorrelated = paths.every(filePath =>
      pathMap.get(filePath).filter(pat => pat !== pattern).length > 0
    )

    isCorrelated ? correlatedPaths.push(pattern) : clearedPatterns.push(pattern)
  }

  return { clearedPatterns, correlatedPaths }
}

const fixPattern = (pattern) => {
  const isDirectory = () => pattern.slice(-1) === '/'
  const isGlobalIgnore = () => pattern.slice(0, 1) === '*'

  let newPattern = pattern
  if (isDirectory()) newPattern = `${pattern}*`
  else if (isGlobalIgnore()) newPattern = `**/${pattern}`

  return newPattern
}

const getFilesFromPattern = (globFormatPattern) => {
  return flattenDirectory(glob.sync(globFormatPattern))
}

const patternFilesMap = ignorePatterns.reduce((acc, pattern) => {
  const globFormatPattern = fixPattern(pattern)
  acc.set(pattern, getFilesFromPattern(globFormatPattern))
  return acc
}, new Map())

const main = async () => {
  const { clearedPatterns, correlatedPaths } = removeCorrelatedPatterns(patternFilesMap)
  const pathsToBeDeleted = [...correlatedPaths]

  for (const pattern of clearedPatterns) {
    const foundFilesPaths = patternFilesMap.get(pattern)

    const lintCorrected = await getLintCorrectFilePaths(foundFilesPaths, pattern, pathsToBeDeleted)
    pathsToBeDeleted.push(...lintCorrected)
  }

  pathsToBeDeleted.forEach(path => deleteLine(path))
}
main()
