package uk.noammm.kav.data

// Trips past midnight are written as 24:00 and later, so last night's run of one can still be to come.
fun Net.departuresAt(stop: Int, now: Int, today: Int, limit: Int = 60): List<Pair<Int, Int>> {
    val yesterday = (today + 6) % 7
    val out = ArrayList<Pair<Int, Int>>()
    var i = dStart[stop]
    while (i < dStart[stop + 1]) {
        val c = dConn[i]
        val st = cST[c]
        val dep = stDep[st]
        val t = tripOf(st)
        if (dep >= now && runsOn(t, today)) out.add(c to dep)
        if (dep - 86_400 >= now && runsOn(t, yesterday)) out.add(c to dep - 86_400)
        i++
    }
    return out.sortedBy { it.second }.take(limit)
}
