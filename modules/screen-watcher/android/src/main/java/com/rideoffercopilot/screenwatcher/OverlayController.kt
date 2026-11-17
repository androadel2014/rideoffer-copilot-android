package com.rideoffercopilot.screenwatcher

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.hardware.input.InputManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.widget.TextViewCompat

/**
 * The glanceable verdict card drawn over the Uber/Lyft driver app.
 *
 * vc13:
 * - NON-BLOCKING. The verdict window is not focusable and not touchable, AND its window
 *   opacity is kept at the system's "maximum obscuring opacity" (0.8 by default). Since
 *   Android 12 the system DROPS touches that pass through another app's overlay that is
 *   more opaque than that. vc12 drew the window fully opaque, so taps on Uber's ✕ or
 *   Accept under the verdict never arrived, even with FLAG_NOT_TOUCHABLE.
 * - The only touchable part is a small ✕ handle in a separate 48 dp window at the
 *   verdict's top-right corner: tap it to close the verdict, or drag it sideways to swipe
 *   the verdict away. Everything else passes through to the driver app.
 * - PERSISTENT. A live verdict (with cardSeq) stays until the driver closes it or a newer
 *   card's verdict replaces it. Accepting, declining or the request timing out does not
 *   clear it. Previews from the app (no cardSeq) keep the overlay-seconds timer.
 * - Per-card identity: a verdict for a card older than the newest emitted card is never
 *   drawn (CardPresence.isLatest).
 * - Shows NET $/hr and $/mi (big) with GROSS $/hr and $/mi beneath each, plus the rider
 *   rating ("★ 4.94", vc12).
 * - Publishes its on-screen rectangle so the OCR loop can ignore its own text, and can be
 *   hidden for a single read when it covers a newly arrived card (suspendForRead).
 */
internal object OverlayController {
  private val main = Handler(Looper.getMainLooper())
  private var view: View? = null
  private var windowManager: WindowManager? = null
  private val hideRunnable = Runnable { hideNow() }
  private val clearRectRunnable = Runnable { screenRect = null }

  /** cardSeq of the verdict on screen; 0 for a preview or when nothing is shown. */
  private var shownSeq = 0L

  // vc13: the ✕ / swipe handle (a separate, touchable 48 dp window).
  private var handle: View? = null
  private var rootParams: WindowManager.LayoutParams? = null

  // vc13: hidden for one read of a new card that it covers.
  private var suspended = false
  private var savedRect: Rect? = null
  private val resumeRunnable = Runnable { resumeNow() }

  /** elapsedRealtime when the verdict was hidden for a read; 0 when not hidden. */
  @Volatile
  var suspendedAt: Long = 0L
    private set

  @Volatile
  private var screenRect: Rect? = null

  fun visibleScreenRect(): Rect? = screenRect

  fun show(ctx: Context, p: Map<String, Any?>): Boolean {
    val allowed = try { Settings.canDrawOverlays(ctx) } catch (_: Throwable) { false }
    if (!allowed) return false
    val seq = (p["cardSeq"] as? Number)?.toLong() ?: 0L
    // Per-card identity: a verdict for an older card never replaces a newer card's verdict.
    if (seq != 0L && !CardPresence.isLatest(seq)) return false
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
        headlineColumn(
          ctx, (p["hourLabel"] as? String) ?: "NET / HOUR", (p["hour"] as? String) ?: "—",
          (p["grossHourLabel"] as? String) ?: "GROSS / HOUR", p["grossHour"] as? String, fg, ::dp
        ),
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(10) }
      )
      headline.addView(
        headlineColumn(
          ctx, (p["mileLabel"] as? String) ?: "NET / MILE", (p["mile"] as? String) ?: "—",
          (p["grossMileLabel"] as? String) ?: "GROSS / MILE", p["grossMile"] as? String, fg, ::dp
        ),
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
      )
      root.addView(headline)
      // vc13: what "net" means, in one short line.
      val netNote = (p["netNote"] as? String) ?: ""
      if (netNote.isNotBlank()) {
        root.addView(TextView(ctx).apply {
          text = netNote
          setTextColor(fg)
          alpha = 0.8f
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
          maxLines = 1
          setPadding(0, dp(4), 0, 0)
        })
      }

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
        // vc13: at or under the system's max obscuring opacity, so touches pass through.
        alpha = passThroughOpacity(ctx)
      }

      // Conservative exclusion zone right away; refined after layout.
      screenRect = if (position == "center") {
        val h = ctx.resources.displayMetrics.heightPixels
        Rect(0, h / 2 - dp(200), screenW, h / 2 + dp(200))
      } else {
        // vc13: taller than vc12 (gross figures + net note).
        Rect(0, dp(40), screenW, dp(56) + dp(320))
      }

      root.alpha = 0f
      wm.addView(root, params)
      root.animate().alpha(1f).setDuration(140).start()
      view = root
      windowManager = wm
      rootParams = params
      shownSeq = seq
      root.post {
        if (view !== root) return@post
        try {
          val loc = IntArray(2)
          root.getLocationOnScreen(loc)
          screenRect = Rect(loc[0], loc[1] - dp(8), loc[0] + root.width, loc[1] + root.height + dp(8))
          addHandle(ctx, wm, root, loc, bg, fg, density)
        } catch (_: Throwable) {}
      }

      if (seq == 0L) {
        // Previews (Try the grader, Settings): unchanged, auto-dismiss after the overlay seconds.
        val duration = ((p["durationMs"] as? Number)?.toLong() ?: 6000L).coerceIn(1500L, 30000L)
        main.postDelayed(hideRunnable, duration)
      }
      // vc13: a live verdict has no timer. It stays until the driver closes it or a newer
      // card's verdict replaces it.
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

  /**
   * vc13: hide the verdict for one read, because it covers part of a newly arrived card.
   * Called from the capture thread. The new card's verdict replaces it; if no new card is
   * read, resumeAfterRead() (or a 2.5 s safety timer) puts it back.
   */
  fun suspendForRead() {
    main.postAtFrontOfQueue {
      val v = view ?: return@postAtFrontOfQueue
      if (suspended) return@postAtFrontOfQueue
      suspended = true
      v.visibility = View.INVISIBLE
      handle?.visibility = View.INVISIBLE
      main.removeCallbacks(clearRectRunnable)
      savedRect = screenRect
      screenRect = null
      suspendedAt = SystemClock.elapsedRealtime()
      main.postDelayed(resumeRunnable, 2_500L)
    }
  }

  /** vc13: put a verdict hidden by suspendForRead() back. Called from the capture thread. */
  fun resumeAfterRead() {
    main.post { resumeNow() }
  }

  private fun resumeNow() {
    main.removeCallbacks(resumeRunnable)
    suspendedAt = 0L
    if (!suspended) return
    suspended = false
    view?.visibility = View.VISIBLE
    handle?.visibility = View.VISIBLE
    if (view != null) screenRect = savedRect
    savedRect = null
  }

  /**
   * vc13: the only touchable part of the overlay. A 48 dp ✕ at the verdict's top-right
   * corner, in its own small window. Tap it to close the verdict, or drag it sideways to
   * swipe the verdict away (the verdict follows the finger). Every touch outside this
   * handle passes through to the driver app.
   */
  private fun addHandle(ctx: Context, wm: WindowManager, root: View, loc: IntArray, bg: Int, fg: Int, density: Float) {
    fun dp(v: Int): Int = (v * density).toInt()
    val size = dp(48)
    val h = TextView(ctx).apply {
      text = "✕"
      gravity = Gravity.CENTER
      setTextColor(fg)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
      typeface = Typeface.create("sans-serif-black", Typeface.BOLD)
      includeFontPadding = false
      contentDescription = "Close verdict"
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.argb(235, Color.red(bg) * 3 / 4, Color.green(bg) * 3 / 4, Color.blue(bg) * 3 / 4))
        setStroke(dp(2), fg)
      }
    }
    val hp = WindowManager.LayoutParams(
      size,
      size,
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT
    ).apply {
      gravity = Gravity.TOP or Gravity.START
      x = loc[0] + root.width - size - dp(8)
      y = loc[1] + dp(8)
      title = "RideOffer Copilot verdict close"
    }
    var downX = 0f
    var moved = 0f
    val startX = rootParams?.x ?: 0
    h.setOnTouchListener { _, e ->
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = e.rawX
          moved = 0f
        }
        MotionEvent.ACTION_MOVE -> {
          moved = e.rawX - downX
          rootParams?.let { rp ->
            rp.x = startX + moved.toInt()
            try { wm.updateViewLayout(root, rp) } catch (_: Throwable) {}
          }
        }
        MotionEvent.ACTION_UP -> {
          val dist = Math.abs(moved)
          if (dist < dp(10) || dist >= dp(60)) {
            dismissByDriver() // tap on ✕, or a swipe
          } else {
            rootParams?.let { rp ->
              rp.x = startX
              try { wm.updateViewLayout(root, rp) } catch (_: Throwable) {}
            }
          }
        }
        MotionEvent.ACTION_CANCEL -> rootParams?.let { rp ->
          rp.x = startX
          try { wm.updateViewLayout(root, rp) } catch (_: Throwable) {}
        }
      }
      true
    }
    wm.addView(h, hp)
    handle = h
  }

  /** The driver closed or swiped the verdict away. */
  private fun dismissByDriver() {
    hideNow()
  }

  /** Window opacity at which Android (12+) still lets touches through to the app below. */
  private fun passThroughOpacity(ctx: Context): Float {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return 1f
    val max = try {
      ctx.getSystemService(InputManager::class.java)?.maximumObscuringOpacityForTouch ?: 0.8f
    } catch (_: Throwable) {
      0.8f
    }
    return (max * 0.98f).coerceIn(0.1f, 0.8f)
  }

  private fun hideNow() {
    main.removeCallbacks(hideRunnable)
    main.removeCallbacks(resumeRunnable)
    shownSeq = 0L
    suspended = false
    suspendedAt = 0L
    savedRect = null
    rootParams = null
    val hv = handle
    handle = null
    val v = view
    val wm = windowManager
    view = null
    windowManager = null
    if (hv != null && wm != null) try { wm.removeViewImmediate(hv) } catch (_: Throwable) {}
    if (v != null && wm != null) {
      try { wm.removeViewImmediate(v) } catch (_: Throwable) {}
      // Keep excluding the area briefly: a frame captured just before removal may still show it.
      main.postDelayed(clearRectRunnable, 1500)
    }
  }

  /**
   * Small uppercase label over a huge NET number that shrinks to fit (e.g. "$1.42/mi"),
   * with the GROSS figure for the same unit labelled directly beneath it (vc13).
   */
  private fun headlineColumn(
    ctx: Context,
    label: String,
    value: String,
    grossLabel: String,
    grossValue: String?,
    fg: Int,
    dp: (Int) -> Int,
  ): LinearLayout {
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
    if (!grossValue.isNullOrBlank()) {
      col.addView(TextView(ctx).apply {
        text = "$grossLabel  $grossValue"
        setTextColor(fg)
        alpha = 0.92f
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        maxLines = 1
        setPadding(0, dp(2), 0, 0)
        TextViewCompat.setAutoSizeTextTypeUniformWithConfiguration(this, 10, 15, 1, TypedValue.COMPLEX_UNIT_SP)
      }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(22)))
    }
    return col
  }

  private fun color(v: Any?, fallback: Int): Int = try {
    (v as? String)?.let { Color.parseColor(it) } ?: fallback
  } catch (_: Throwable) {
    fallback
  }
}
