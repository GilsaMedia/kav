package uk.noammm.kav.data

import java.net.URLDecoder
import java.net.URLEncoder
import java.util.Locale

object MoovitLink {
    class Ride(val lineId: Int, val tripId: Long, val depSec: Long)

    class Plan(
        val fromName: String?, val fromLat: Double?, val fromLon: Double?,
        val toName: String?, val toLat: Double?, val toLon: Double?,
        val departMs: Long,
        val autoRun: Boolean,
        val rides: List<Ride> = emptyList(),
    )

    fun share(
        fromName: String?, fromLat: Double?, fromLon: Double?,
        toName: String?, toLat: Double, toLon: Double, departMs: Long = 0L,
        rides: List<Ride> = emptyList(),
    ): String = buildString {
        append("https://moovitapp.com/directions")
        append("?dest_lat="); append(coord(toLat))
        append("&dest_lon="); append(coord(toLon))
        if (!toName.isNullOrBlank()) { append("&dest_name="); append(encode(toName)) }
        if (fromLat != null && fromLon != null) {
            append("&orig_lat="); append(coord(fromLat))
            append("&orig_lon="); append(coord(fromLon))
            if (!fromName.isNullOrBlank()) { append("&orig_name="); append(encode(fromName)) }
        }
        if (departMs > 0L) { append("&date="); append(departMs) }
        if (rides.isNotEmpty()) {
            append("&kav_trip=")
            append(rides.joinToString("~") { "${it.lineId}.${it.tripId}.${it.depSec}" })
        }
    }

    fun parse(url: String?): Plan? {
        if (url.isNullOrBlank()) return null
        val trimmed = url.trim()
        val scheme = trimmed.substringBefore("://", "").lowercase(Locale.US)
        val rest = trimmed.substringAfter("://", "")
        if (rest.isEmpty()) return null
        val hostAndPath = rest.substringBefore('?').substringBefore('#')
        val host = hostAndPath.substringBefore('/').lowercase(Locale.US)
        val path = hostAndPath.removePrefix(host).trimEnd('/').lowercase(Locale.US)
        val ok = when (scheme) {
            "moovit" -> host == "directions"
            "https", "http" -> (host == "moovitapp.com" || host == "www.moovitapp.com") && path == "/directions"
            else -> false
        }
        if (!ok) return null
        val query = rest.substringAfter('?', "").substringBefore('#')
        val params = HashMap<String, String>()
        for (pair in query.split('&')) {
            if (pair.isEmpty()) continue
            val key = pair.substringBefore('=')
            if (key !in params) params[key] = runCatching {
                URLDecoder.decode(pair.substringAfter('=', "").replace("+", "%2B"), "UTF-8")
            }.getOrDefault("")
        }
        fun latLon(latKey: String, lonKey: String): Pair<Double, Double>? {
            val lat = params[latKey]?.toDoubleOrNull() ?: return null
            val lon = params[lonKey]?.toDoubleOrNull() ?: return null
            if (!lat.isFinite() || !lon.isFinite() || lat !in -90.0..90.0 || lon !in -180.0..180.0) return null
            return lat to lon
        }
        val from = latLon("orig_lat", "orig_lon")
        val fromName = params["orig_name"]?.takeIf { it.isNotBlank() }
        val to = latLon("dest_lat", "dest_lon")
        val toName = params["dest_name"]?.takeIf { it.isNotBlank() }
        if (to == null && toName == null) return null
        val autoRun = when (params["auto_run"]) {
            "false", "0" -> false
            else -> true
        }
        return Plan(
            fromName, from?.first, from?.second,
            toName, to?.first, to?.second,
            departMs = params["date"]?.toLongOrNull()?.coerceAtLeast(0L) ?: 0L,
            autoRun = autoRun,
            rides = ridesOf(params["kav_trip"]),
        )
    }

    private fun ridesOf(v: String?): List<Ride> {
        if (v.isNullOrBlank()) return emptyList()
        val out = ArrayList<Ride>()
        for (part in v.split('~')) {
            val bits = part.split('.')
            if (bits.size != 3) return emptyList()
            val line = bits[0].toIntOrNull() ?: return emptyList()
            val trip = bits[1].toLongOrNull() ?: return emptyList()
            val dep = bits[2].toLongOrNull() ?: return emptyList()
            out.add(Ride(line, trip, dep))
        }
        return out
    }

    private fun coord(v: Double) = String.format(Locale.US, "%.6f", v)

    private fun encode(v: String) = URLEncoder.encode(v, "UTF-8").replace("+", "%20")
}
