package uk.noammm.kav.data

import org.json.JSONArray
import org.json.JSONObject

// Keep the server's complete itinerary when sending it back to Moovit's sharing API.
internal fun thriftFields(o: JSONObject): TWriter = TWriter().jsonFields(o)

private fun typeOf(tag: String): Int = when (tag) {
    "tf" -> TType.BOOL; "i8", "byte" -> TType.BYTE; "i16" -> TType.I16
    "i32" -> TType.I32; "i64" -> TType.I64; "dbl" -> TType.DOUBLE
    "str" -> TType.STRING; "rec" -> TType.STRUCT; "lst" -> TType.LIST
    "set" -> TType.SET; "map" -> TType.MAP
    else -> error("Unknown Thrift type: $tag")
}

private fun TWriter.jsonFields(o: JSONObject): TWriter {
    for (key in o.keys()) {
        val wrapped = o.getJSONObject(key)
        val tag = wrapped.keys().next()
        field(typeOf(tag), key.toInt())
        jsonValue(tag, wrapped.get(tag))
    }
    return this
}

private fun TWriter.jsonValue(tag: String, value: Any) {
    when (tag) {
        "tf", "i8", "byte" -> byte(value.toString().toInt())
        "i16" -> i16(value.toString().toInt())
        "i32" -> i32(value.toString().toInt())
        "i64" -> i64(value.toString().toLong())
        "dbl" -> i64(value.toString().toDouble().toBits())
        "str" -> str(value.toString())
        "rec" -> { jsonFields(value as JSONObject); stop() }
        "lst", "set" -> {
            val list = value as JSONArray
            val element = list.getString(0)
            val count = list.getInt(1)
            require(count == list.length() - 2)
            byte(typeOf(element)); i32(count)
            for (i in 2 until list.length()) jsonValue(element, list.get(i))
        }
        "map" -> {
            val map = value as JSONArray
            val key = map.getString(0); val item = map.getString(1)
            val values = map.getJSONObject(3)
            require(map.getInt(2) == values.length())
            byte(typeOf(key)); byte(typeOf(item)); i32(values.length())
            for (k in values.keys()) { jsonValue(key, k); jsonValue(item, values.get(k)) }
        }
        else -> error("Unknown Thrift type: $tag")
    }
}
