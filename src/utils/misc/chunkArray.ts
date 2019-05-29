//https://ourcodeworld.com/articles/read/278/how-to-split-an-array-into-chunks-of-the-same-size-easily-in-javascript
function chunkArray(srcArray: Array<object>, chunkSize: number) {
  let idx = 0
  let tmpArray = []
  for (idx = 0; idx < srcArray.length; idx += chunkSize) {
    tmpArray.push(srcArray.slice(idx, idx + chunkSize))
  }
  return tmpArray
}
export default chunkArray
