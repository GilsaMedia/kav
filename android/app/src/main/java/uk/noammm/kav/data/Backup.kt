package uk.noammm.kav.data

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import uk.noammm.kav.Prefs
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Backup {
    const val VERSION = 1

    const val MIME = "application/octet-stream"

    class NotABackup : Exception()

    data class Restored(val favourites: Int, val trips: Int, val recents: Int)

    fun suggestedName(nowMs: Long = System.currentTimeMillis()): String =
        "kav-" + SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(nowMs)) + ".kav"

    fun looksLikeBackup(ctx: Context, uri: Uri): Boolean {
        if ((uri.lastPathSegment ?: uri.path ?: "").endsWith(".$EXT", true)) return true
        val name = runCatching {
            ctx.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { if (it.moveToFirst()) it.getString(0) else null }
        }.getOrNull()
        return name?.endsWith(".$EXT", true) == true
    }

    private const val EXT = "kav"

    // Off the main thread: a cloud provider can take seconds to fetch or upload the file.
    suspend fun write(ctx: Context, uri: Uri): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val doc = Prefs.backupJson(ctx)
                .put("kav", VERSION)
                .put("saved", System.currentTimeMillis())
                .put("app", Updates.installedVersion(ctx))
            val out = ctx.contentResolver.openOutputStream(uri, "wt") ?: throw java.io.IOException("no stream")
            out.use { it.write(doc.toString(2).toByteArray(Charsets.UTF_8)) }
        }
    }

    suspend fun read(ctx: Context, uri: Uri): Result<Restored> = withContext(Dispatchers.IO) {
        runCatching {
            val text = ctx.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
                ?: throw java.io.IOException("no stream")
            val o = try { JSONObject(text) } catch (e: Exception) { throw NotABackup() }
            if (o.optInt("kav", -1) !in 1..VERSION) throw NotABackup()
            Prefs.restoreBackup(ctx, o)
            Restored(
                o.optJSONArray("favourites")?.length() ?: 0,
                o.optJSONArray("trips")?.length() ?: 0,
                o.optJSONArray("recents")?.length() ?: 0,
            )
        }
    }
}
