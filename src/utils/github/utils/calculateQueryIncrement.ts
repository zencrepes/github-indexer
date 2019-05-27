function calculateQueryIncrement(recordsInCollection: number, totalCount: number, maxIncrement: number) {
  let queryIncrement = maxIncrement
  if (totalCount === recordsInCollection) {
    queryIncrement = 0
  } else if (totalCount - recordsInCollection <= maxIncrement) {
    queryIncrement = totalCount - recordsInCollection
  }

  //console.log("Records in collection: " + recordsInCollection);
  //console.log("Total Count: " + totalCount);
  //console.log("Increment: " + queryIncrement);
  // Always return 10 as minimum increment
  //    if (queryIncrement < 10) {queryIncrement = 10;}
  return queryIncrement
}
export default calculateQueryIncrement
