package com.rideoffercopilot.android

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

/** Brief, dismissible TOP badge; never placed over bottom accept controls. */
class LiveOverlay(context: Context) {
    private val app = context.applicationContext
    private val window = app.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    private val handler = Handler(Looper.getMainLooper())
    private var badge: View? = null
    private var removal: Runnable? = null

    fun show(offer: OfferRecord): Boolean {
        if (!Settings.canDrawOverlays(app)) return false
        hide()
        return try {
            val isAccept = offer.verdict == "green"
            val color = if (isAccept) Color.rgb(22, 120, 64) else Color.rgb(172, 35, 52)
            val bg = GradientDrawable().apply { setColor(color); cornerRadius = dp(16f).toFloat() }
            val panel = LinearLayout(app).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                background = bg
                elevation = dp(12f).toFloat()
                setPadding(dp(18f), dp(12f), dp(18f), dp(12f))
            }
            val heading = TextView(app).apply {
                text = if (isAccept) "ACCEPT · tap to dismiss ×" else "SKIP · tap to dismiss ×"
                textSize = 18f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
                setTypeface(null, android.graphics.Typeface.BOLD)
            }
            val metrics = TextView(app).apply {
                text = String.format(Locale.US, "NET $%.2f/mi  ·  $%.2f/hr", offer.netDollarsPerMile, offer.netDollarsPerHour)
                textSize = 15f; setTextColor(Color.WHITE); gravity = Gravity.CENTER
            }
            panel.addView(heading); panel.addView(metrics)
            panel.setOnClickListener { hide() }
            val flags = WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
            val params = WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.WRAP_CONTENT,
                if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE,
                flags, android.graphics.PixelFormat.TRANSLUCENT
            ).apply { gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; y = dp(72f) }
            window.addView(panel, params)
            badge = panel
            removal = Runnable {
                panel.animate().alpha(0f).setDuration(320L).withEndAction { if (badge === panel) hide() }.start()
            }.also { handler.postDelayed(it, 4600L) }
            true
        } catch (_: Exception) { hide(); false }
    }

    fun hide() {
        removal?.let(handler::removeCallbacks); removal = null
        badge?.let { try { window.removeView(it) } catch (_: Exception) {} }
        badge = null
    }

    private fun dp(value: Float): Int = (value * app.resources.displayMetrics.density).toInt()
}
