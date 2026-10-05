package uk.noammm.kav.ui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import uk.noammm.kav.data.MoovitPay

// Recover a purchase whose reply was lost by checking which tickets appeared on the account.
internal class PayPurchase {
    private val lock = Mutex()
    var busy by mutableStateOf(false)
        private set

    class Unconfirmed(cause: Exception) : Exception(cause)

    suspend fun run(
        snapshot: suspend () -> List<MoovitPay.Ticket>,
        buy: suspend () -> List<MoovitPay.Ticket>,
        prepare: suspend () -> Unit = {},
    ): List<MoovitPay.Ticket> {
        if (!lock.tryLock()) throw MoovitPay.Refused("", T("A payment is already in progress.", "כבר מתבצע תשלום."))
        busy = true
        try {
            // Without the before-list a lost reply cannot be recovered safely, so do not send the purchase.
            val before = snapshot().map { it.id to it.ref }.toSet()
            prepare()
            return try { buy() } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (e is MoovitPay.Refused) throw e
                val after = try { snapshot() } catch (cancel: CancellationException) { throw cancel }
                    catch (failed: Exception) { throw Unconfirmed(e) }
                after.filter { (it.id to it.ref) !in before }.ifEmpty { throw Unconfirmed(e) }
            }
        } finally {
            busy = false
            lock.unlock()
        }
    }
}
