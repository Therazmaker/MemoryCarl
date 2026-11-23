package com.memorycarl.widgets

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.TextView

/** Piezas de interfaz hechas en código (sin librerías extra). */
object Ui {
    val ACCENT = Color.parseColor("#7C5CFF")

    fun dp(ctx: Context, v: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), ctx.resources.displayMetrics).toInt()

    fun column(ctx: Context, pad: Int = 16): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(ctx, pad), dp(ctx, pad), dp(ctx, pad), dp(ctx, pad))
    }

    fun row(ctx: Context): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
    }

    fun text(ctx: Context, s: String, size: Float = 15f, bold: Boolean = false, muted: Boolean = false): TextView = TextView(ctx).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
        if (bold) setTypeface(typeface, Typeface.BOLD)
        if (muted) alpha = 0.7f
        setPadding(0, dp(ctx, 4), 0, dp(ctx, 4))
    }

    fun input(ctx: Context, hint: String, type: Int = InputType.TYPE_CLASS_TEXT): EditText = EditText(ctx).apply {
        this.hint = hint
        inputType = type
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
    }

    fun rounded(color: Int, radius: Float, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(color)
        cornerRadius = radius
        if (stroke != null) setStroke(3, stroke)
    }

    fun button(ctx: Context, s: String, primary: Boolean = false, onClick: (View) -> Unit): Button = Button(ctx).apply {
        text = s
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
        if (primary) {
            background = rounded(ACCENT, dp(ctx, 14).toFloat())
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
        }
        setOnClickListener(onClick)
    }

    /** Fila de "chips" que se desliza de lado; devuelve la fila para agregarle botones. */
    fun chipRow(ctx: Context, parent: ViewGroup): LinearLayout {
        val scroll = HorizontalScrollView(ctx).apply { isHorizontalScrollBarEnabled = false }
        val r = row(ctx)
        scroll.addView(r)
        parent.addView(scroll)
        return r
    }

    fun chip(ctx: Context, s: String, onClick: (Button) -> Unit): Button = Button(ctx).apply {
        text = s
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        minWidth = 0
        minimumWidth = 0
        setPadding(dp(ctx, 14), 0, dp(ctx, 14), 0)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(ctx, 40)).apply { marginEnd = dp(ctx, 6) }
        setChipOn(this, false)
        setOnClickListener { onClick(this) }
    }

    fun setChipOn(b: Button, on: Boolean) {
        val ctx = b.context
        b.background = if (on) rounded(ACCENT, dp(ctx, 20).toFloat()) else rounded(Color.parseColor("#22888888"), dp(ctx, 20).toFloat(), Color.parseColor("#55888888"))
        if (on) b.setTextColor(Color.WHITE) else b.setTextColor(TextView(ctx).currentTextColor)
    }

    fun spacer(ctx: Context, h: Int = 8): View = View(ctx).apply {
        layoutParams = LinearLayout.LayoutParams(1, dp(ctx, h))
    }

    /** Pide el teclado apenas se abre la ventanita. */
    fun focus(activity: Activity, v: EditText) {
        v.requestFocus()
        activity.window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
    }
}
