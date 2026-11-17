package com.rideoffercopilot.screenwatcher

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.widget.TextViewCompat

/**
 * The glanceable verdict card drawn over the Uber/Lyft driver app.
 *
 * - Not focusable and not touchable: every tap passes straight through to the driver
 *   app underneath, so the overlay can never block the Accept button.
 * - Auto-dismisses after durationMs.
 * - vc12: a live verdict carries the `cardSeq` of its offer card. It is drawn only while
 *   that card is still on screen (CardPresence), and removed as soon as the capture loop
 *   sees the card go (hideForCard). Previews from the app (no cardSeq) are unchanged.
 * - vc12: shows the rider's star rating ("★ 4.94") next to the verdict.
 * - Publishes its on-screen rectangle so the OCR loop can ignore its own text.
 */
internal object OverlayController {
  private val main = Handler(Looper.getMainLooper())
  private var view: View? = null
  private var windowManager: WindowManager? = null
  private val hideRunnable = Runnable { hideNow() }
  private val clearRectRunnable = Runnable { screenRect = null }

  /** cardSeq of the verdict on screen; 0 for a preview or when nothing is shown. */
  private var shownSeq = 0L

  @Volatile
  private var screenRect: Rect? = null

  fun visibleScreenRect(): Rect? = screenRect

  fun show(ctx: Context, p: Map<String, Any?>): Boolean {
    val allowed = try { Settings.canDrawOverlays(ctx) } catch (_: Throwable) { false }
    if (!allowed) return false
    val seq = (p["cardSeq"] as? Number)?.toLong() ?: 0L
    // A verdict whose card has already closed (or been replaced) is never drawn.
    if (seq != 0L && !CardPresence.isActive(seq)) return false
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { show(ctx, p) }
      return true
    }
    return try {
      hideNow()
      main.removeCallbacks(clearRectRunnable)
      val wm = ctx.getSystemService(WindowManager::class.java) ?: return false
      val density = ctx.resources.displayMetrics.density
      fun dp(v: Int): Int = (v * density).toInt()

      val bg = color(p["background"], Color.parseColor("#15803D"))
      val fg = color(p["foreground"], Color.WHITE)

      val root = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(22), dp(14), dp(22), dp(18))
        background = GradientDrawable().apply {
          cornerRadius = dp(28).toFloat()
          setColor(bg)
          setStroke(dp(2), Color.argb(70, 0, 0, 0))
        }
        elevation = dp(12).toFloat()
      }

      // 1) Headline: the two numbers a driver reads at a glance — NET $/hr and NET ¢/mi.
      val headline = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.BOTTOM
      }
      headline.addView(
        headlineColumn(ctx, (p["hourLabel"] as? String) ?: "NET / HOUR", (p["hour"] as? String) ?: "—", fg, ::dp),
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(10) }
      )
      headline.addView(
        headlineColumn(ctx, (p["mileLabel"] as? String) ?: "NET / MILE", (p["mile"] as? String) ?: "—", fg, ::dp),
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
      )
      root.addView(headline)

      root.addView(View(ctx).apply {
        setBackgroundColor(Color.argb(60, Color.red(fg), Color.green(fg), Color.blue(fg)))
      }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(2)).apply {
        topMargin = dp(10); bottomMargin = dp(10)
      })

      // 2) Supporting line: verdict pill + short human reason.
      val support = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
      }
      support.addView(TextView(ctx).apply {
        text = (p["verdict"] as? String) ?: ""
        setTextColor(bg)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
        letterSpacing = 0.06f
        includeFontPadding = false
        setPadding(dp(12), dp(6), dp(12), dp(6))
        background = GradientDrawable().apply {
          cornerRadius = dp(10).toFloat()
          setColor(fg)
        }
      })
      val reasonText = (p["reason"] as? String) ?: ""
      if (reasonText.isNotBlank()) {
        support.addView(TextView(ctx).apply {
          text = reasonText
          setTextColor(fg)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
          typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
          maxLines = 2
          setPadding(dp(12), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
      }
      // vc12: rider rating chip, e.g. "★ 4.94" (omitted when the card shows no rating).
      val ratingText = (p["rating"] as? String) ?: ""
      if (ratingText.isNotBlank()) {
        support.addView(TextView(ctx).apply {
          text = ratingText
          setTextColor(fg)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
          typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
          includeFontPadding = false
          maxLines = 1
          setPadding(dp(10), dp(6), dp(10), dp(6))
          background = GradientDrawable().apply {
            cornerRadius = dp(10).toFloat()
            setColor(Color.argb(40, Color.red(fg), Color.green(fg), Color.blue(fg)))
          }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
          marginStart = dp(10)
        })
      }
      root.addView(support)

      // 3) Optional flags.
      val detailText = (p["detail"] as? String) ?: ""
      if (detailText.isNotBlank()) {
        root.addView(TextView(ctx).apply {
          text = detailText
          setTextColor(fg)
          alpha = 0.88f
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
          maxLines = 2
          setPadding(0, dp(8), 0, 0)
        })
      }

      val screenW = ctx.resources.displayMetrics.widthPixels
      val position = (p["position"] as? String) ?: "top"
      val params = WindowManager.LayoutParams(
        screenW - dp(24),
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT
      ).apply {
        gravity = if (position == "center") Gravity.CENTER else (Gravity.TOP or Gravity.CENTER_HORIZONTAL)
        y = if (position == "center") 0 else dp(56)
        title = "RideOffer Copilot verdict"
      }

      // Conservative exclusion zone right away; refined after layout.
      screenRect = if (position == "center") {
        val h = ctx.resources.displayMetrics.heightPixels
        Rect(0, h / 2 - dp(170), screenW, h / 2 + dp(170))
      } else {
        Rect(0, dp(40), screenW, dp(56) + dp(260))
      }

      root.alpha = 0f
      wm.addView(root, params)
      root.animate().alpha(1f).setDuration(140).start()
      root.post {
        try {
          val loc = IntArray(2)
          root.getLocationOnScreen(loc)
          screenRect = Rect(loc[0], loc[1] - dp(8), loc[0] + root.width, loc[1] + root.height + dp(8))
        } catch (_: Throwable) {}
      }
      view = root
      windowManager = wm
      shownSeq = seq
      // The card may have closed while this was being laid out.
      if (seq != 0L && !CardPresence.isActive(seq)) {
        hideNow()
        return false
      }

      val duration = ((p["durationMs"] as? Number)?.toLong() ?: 6000L).coerceIn(1500L, 30000L)
      main.postDelayed(hideRunnable, duration)
      true
    } catch (t: Throwable) {
      hideNow()
      false
    }
  }

  fun hide() {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      main.post { hideNow() }
    } else {
      hideNow()
    }
  }

  /** vc12: the offer card with this sequence number left the screen. Called from the capture thread. */
  fun hideForCard(seq: Long) {
    if (seq == 0L) return
    val run = Runnable { if (shownSeq == seq) hideNow() }
    if (Looper.myLooper() == Looper.getMainLooper()) run.run() else main.postAtFrontOfQueue(run)
  }

  private fun hideNow() {
    main.removeCallbacks(hideRunnable)
    shownSeq = 0L
    val v = view
    val wm = windowManager
    view = null
    windowManager = null
    if (v != null && wm != null) {
      try { wm.removeViewImmediate(v) } catch (_: Throwable) {}
      // Keep excluding the area briefly: a frame captured just before removal may still show it.
      main.postDelayed(clearRectRunnable, 1500)
    }
  }

  /** Small uppercase label over a huge number that shrinks to fit (e.g. "$1.42/mi"). */
  private fun headlineColumn(ctx: Context, label: String, value: String, fg: Int, dp: (Int) -> Int): LinearLayout {
    val col = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
    col.addView(TextView(ctx).apply {
      text = label
      setTextColor(fg)
      alpha = 0.85f
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
      letterSpacing = 0.12f
      maxLines = 1
    })
    col.addView(TextView(ctx).apply {
      text = value
      setTextColor(fg)
      typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
      includeFontPadding = false
      maxLines = 1
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 56f)
      TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(this, 26, 60, 2, TypedValue.COMPLEX_UNIT_SP)
    }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(68)))
    return col
  }

  private fun color(v: Any?, fallback: Int): Int = try {
    (v as? String)?.let { Color.parseColor(it) } ?: fallback
  } catch (_: Throwable) {
    fallback
  }
}
