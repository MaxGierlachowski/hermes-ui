package expo.modules.iroh

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps the app process (and with it the iroh connection and the live stream) running while the app
 * is in the background, shown as a quiet ongoing notification. Without it Android's cached-app
 * freezer stops the process seconds after the app leaves the screen, and nothing arrives until it is
 * opened again. Type remoteMessaging (Android 14+): the app relays messages from the user's own backend.
 */
class KeepAliveService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val n = build(this, intent?.getStringExtra(EXTRA_TITLE) ?: "Hermes UI", intent?.getStringExtra(EXTRA_TEXT) ?: "")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING)
    } else {
      startForeground(ID, n)
    }
    return START_NOT_STICKY
  }

  // Swiped away from recents: nothing left to keep alive.
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  companion object {
    const val ID = 4711
    const val CHANNEL = "hermes-connection"
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"

    fun build(ctx: Context, title: String, text: String): Notification {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm.getNotificationChannel(CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "Connection", NotificationManager.IMPORTANCE_MIN).apply {
          description = "Shown while the app stays connected in the background"
          setShowBadge(false)
        })
      }
      val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
      val open = PendingIntent.getActivity(ctx, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      val icon = ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName).takeIf { it != 0 } ?: ctx.applicationInfo.icon
      return NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(icon)
        .setContentTitle(title)
        .setContentText(text)
        .setOngoing(true)
        .setSilent(true)
        .setOnlyAlertOnce(true)
        .setShowWhen(false)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setPriority(NotificationCompat.PRIORITY_MIN)
        .setContentIntent(open)
        .build()
    }
  }
}
