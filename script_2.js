const fs = require('fs')
const glob = require('glob')
const stylelint = require('stylelint')

const ignoreFilePath = '.stylelintignore'
const ignoreFileContent = fs.readFileSync(ignoreFilePath, 'utf8')
const ignorePatterns = ignoreFileContent.split('\r\n').filter(Boolean)

const flattenDirectory = (paths) => {
  return paths.map(path => {
    if (fs.statSync(path).isDirectory()) return flattenDirectory(glob.sync(`${path}/*`))

    return path
  }).flat()
}

const filesToLint = ignorePatterns.reduce((acc, pattern) => {
  const directories = flattenDirectory(glob.sync(pattern))
  acc.push(...directories)

  return acc
}, [])

const isLineIncludesSymbols = (line) => {
  const commentRegex = /\/\*[\s\S]*?\*\//g
  const withoutComment = line.replace(commentRegex, '')
  const trimmed = withoutComment.trim()

  return !!trimmed.length
}

const getFirstSelectorsLine = (fileData, maxLineNum) => {
  const fileArr = fileData.split('\n')
  let targetLine = maxLineNum
  let isComment = false

  for (let lineInd = maxLineNum; lineInd >= 0; lineInd--) {
    const currentLine = fileArr[lineInd]

    const includesCloseBreak = currentLine.includes('}')
    const includesStartComment = currentLine.includes('/*')
    const includesEndComment = currentLine.includes('*/')

    if (includesCloseBreak) break

    if (includesEndComment && !includesStartComment) {
      isComment = true
      continue
    } else if (includesStartComment && !includesEndComment) {
      isComment = false
    } else if (isComment) continue

    if (isLineIncludesSymbols(currentLine)) {
      targetLine = lineInd + 1
    }
  }

  return targetLine
}

const transformedFiles =
  filesToLint.reduce((acc, filePath) => {
    acc[filePath] = { fileData: '' }
    const data = fs.readFileSync(filePath, 'utf8')
      .replaceAll(/(\r\n|\n|\r)/gm, '')
      .replaceAll('{', '{\n')
      .replaceAll(/}(?!})/gm, '}\n\n')
      .replaceAll('}}', '}\n}')
      .replaceAll(';', ';\n')
      .replaceAll('*/', '*/\n')
      .replaceAll(/\/\*(?![*\s])/g, '/* ')
      .replaceAll(/([^*\s])\*+\//g, '$1 */')

    acc[filePath].fileData = data
    return acc
  }, {})

Promise.all(
  Object.entries(transformedFiles).map(async ([filePath, { fileData }]) => {
    const linted = await stylelint.lint({
      code: fileData,
      ignorePath: 'notExistingFile',
      ignoreDisables: true
    })
    if (linted.errored && !fileData.startsWith('/* stylelint-disable */')) transformedFiles[filePath].error = linted
  }
  )
)
  .then(() => {
    const errorsToIgnore = {}

    Object.entries(transformedFiles).forEach(([filePath, { fileData, error }]) => {
      if (!error) return

      if (error.errored) {
        error.results.forEach(err => {
          err.warnings.forEach(warning => {
            if (!errorsToIgnore[filePath]) errorsToIgnore[filePath] = new Set()
            let line = warning.line

            if (warning.rule === 'no-descending-specificity') {
              line = getFirstSelectorsLine(fileData, line)
            }

            errorsToIgnore[filePath].add({ line, lintRule: warning.rule })
          })
        })
      }
    })

    const commentsMap = {}

    for (const [filePath, errorInfo] of Object.entries(errorsToIgnore)) {
      if (!commentsMap[filePath]) commentsMap[filePath] = {}
      const sortedErrorsInfo = [...errorInfo.values()].sort((a, b) => a.line - b.line)

      sortedErrorsInfo.forEach(info => {
        if (!commentsMap[filePath][info.line]) commentsMap[filePath][info.line] = new Set()

        commentsMap[filePath][info.line].add(info.lintRule)
      })
    }

    for (const [filePath, commentsInfo] of Object.entries(commentsMap)) {
      let wroteLinesNum = 0
      const data = transformedFiles[filePath].fileData.split('\n')

      for (const [lineNum, lintRules] of Object.entries(commentsInfo)) {
        const indexToWriteAtStart = lineNum - 1

        const combinedRules = [...lintRules.values()].join(', ')
        data.splice(indexToWriteAtStart + wroteLinesNum, 0, `/* stylelint-disable-next-line ${combinedRules} */`)
        wroteLinesNum++
      }
      fs.writeFileSync(filePath, data.join('\n'), 'utf8')
    }
    fs.truncateSync(ignoreFilePath)
  })
