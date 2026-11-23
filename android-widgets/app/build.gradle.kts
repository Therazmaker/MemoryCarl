plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// La versión la pone la compilación de GitHub (número de ejecución): cada APK nueva se instala encima de la anterior
val buildNumber = (System.getenv("VERSION_CODE") ?: "1").toInt()
val keystorePath: String? = System.getenv("KEYSTORE_PATH")

android {
    namespace = "com.memorycarl.widgets"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.memorycarl.widgets"
        minSdk = 26
        targetSdk = 35
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
    }

    signingConfigs {
        create("release") {
            if (keystorePath != null) {
                storeFile = file(keystorePath)
                storePassword = System.getenv("KEYSTORE_PASSWORD")
                keyAlias = System.getenv("KEY_ALIAS") ?: "widgets"
                keyPassword = System.getenv("KEY_PASSWORD") ?: System.getenv("KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystorePath != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        abortOnError = false
        checkReleaseBuilds = false
    }
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.security:security-crypto:1.0.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    testImplementation("androidx.test:core:1.6.1")
    testImplementation("androidx.work:work-testing:2.9.1")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

// Robolectric (pruebas) necesita un Android simulado. Antes lo bajaba solo en cada prueba y
// Maven Central a veces respondía "demasiadas solicitudes". Ahora lo baja Gradle (con reintentos
// y caché) y las pruebas lo usan sin conexión.
val robolectricJars: Configuration by configurations.creating { isTransitive = false }
dependencies {
    robolectricJars("org.robolectric:android-all-instrumented:14-robolectric-10818077-i7")
}
val robolectricDir = layout.buildDirectory.dir("robolectric-jars")
val copyRobolectricJars by tasks.registering(Copy::class) {
    from(robolectricJars)
    into(robolectricDir)
}
tasks.withType<Test>().configureEach {
    dependsOn(copyRobolectricJars)
    systemProperty("robolectric.offline", "true")
    systemProperty("robolectric.dependency.dir", robolectricDir.get().asFile.absolutePath)
}
