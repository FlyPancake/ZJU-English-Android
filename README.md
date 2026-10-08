# 大英默写器 · Z 安卓移植版

这是基于 [kryptonite309 的大英默写器](https://github.com/kryptonite309/ZJU-English-dictation-tool_kry-advanced) 制作的非官方 Android 移植版，朗读、保存和文件选择由原生 Android 接口实现；无需网页服务器。

这个仓库保存源码，apk 文件通过 Releases 提供，仓库不包含任何人的学习记录。

## 安装

1. 把 `ZJU-English-Z-Android-v1.2.1.apk` 发送到手机。已安装先前版本时可直接覆盖更新，建议先导出学习备份，不要先卸载。
2. 从文件管理器打开安装包，按系统提示允许该文件管理器安装未知来源应用。
3. 安装后打开「大英默写器 · Z」。要求 Android 8.0 及以上，以及支持现代 JavaScript 的 Android System WebView；旧手机请先更新 WebView 或 Chrome。
4. 听写前在设置中打开「系统英语语音设置」，安装英语语音包。朗读音色和离线能力取决于手机的语音引擎。

应用本身没有联网权限，也不申请整个存储空间权限。词书和练习可离线使用；文件通过系统文件选择器导入或导出。手机语音引擎是独立服务，是否联网由其自身设置决定。

## 更新记录

- v1.2.1 增加 windows 版记录迁移功能，注意不是同步。支持多词书同时抽取，每日计划与跨日选项。（v1.2.0 又因为出 bug 被优化掉了）

## 与 Windows 版的差异

- 增加了单词音标。
- 不包含 Windows 多窗口、键盘快捷键体系、窗口独立外观批量应用、原版动态皮肤文件库和 GitHub 自动更新 / 回滚。
- 朗读使用 Android 文字转语音，不使用 Windows System.Speech。没有英语语音包时需要先安装，不能保证所有品牌手机自带英语声音。
- 自定义可接受答案需开启设置中的相应开关；不自动把答错拼写视为正确。
- 当前日历显示当月；统计正确率按实际作答次数计算，包含复现，零作答显示未作答。
- 壁纸、视频文件不包含在 JSON 备份中；恢复后如需壁纸应重新导入。
- 输入和操作后立即保存，学习时钟约每 10 秒落盘；系统强制终止时可能损失最后数秒计时。正常切后台会暂停并保存。
- 撤销记录只保留在本次进程中；学习队列和反馈可跨重启恢复。
- 没有自动云同步和账号。

卸载或清除应用数据会删除本地学习记录，请先导出备份。安装后首次使用建议只抽取 1–2 个词，确认手机的朗读和文件选择器可用。

## 本地构建

需要 Windows PowerShell、JDK 17、Android SDK Platform 35 和 Build Tools 35.0.0。不需要 Gradle、Android Studio 或任何在线运行服务。

```powershell
$env:KRY_STORE_PASSWORD = '你的签名库密码'
.\build.ps1 -JavaHome 'C:\tools\jdk-17' `
  -BuildTools 'C:\Android\Sdk\build-tools\35.0.0' `
  -AndroidJar 'C:\Android\Sdk\platforms\android-35\android.jar' `
  -KeyStore 'C:\private\kry-android.p12'
```

默认签名别名 `kry-android`，编译中间文件写入工作目录，APK 输出到源码目录的上一级。可通过参数覆盖这些路径。`assets/data.json` 已包含完整内置词书，不需要重新拉取原仓库。

如需重新生成词书：

```powershell
node .\tools\prepare-data.js 'C:\path\to\upstream'
node --test .\tests\engine.test.js
```

`assets/phonetics.json` 已包含离线音标子集，重新生成词书会保留音标。需要重新提取时，下载上述来源的 `ecdict.csv` 后运行 `node tools/prepare-phonetics.js C:\path\to\ecdict.csv`。图标处理工具为 `tools/prepare-icon.ps1`，只对与图片边缘连通的白色背景做透明化，避免删除人物的白色区域。

手机界面集成测试需要另行安装 Playwright，并设置 `KRY_CHROME` 为 Chrome 的完整路径，再执行 `node tests/ui.integration.js`。如 Playwright 不在默认依赖路径，可设置 `KRY_PLAYWRIGHT_MODULE`。

朗读界面回归测试运行 `node tests/speech.integration.js`，使用相同 Playwright 环境。原生协调器可用 JDK 运行：

```powershell
javac -encoding UTF-8 -d build-speech-tests src/com/kry/zjuenglish/SpeechController.java tests/SpeechControllerTest.java
java -cp build-speech-tests SpeechControllerTest
```

## 来源与使用说明

感谢 [Lucent-Snow/ZJU-English-dictation-tool](https://github.com/Lucent-Snow/ZJU-English-dictation-tool) 原项目和 [kryptonite309/ZJU-English-dictation-tool_kry-advanced](https://github.com/kryptonite309/ZJU-English-dictation-tool_kry-advanced) 项目。原项目的 README 还提到它参照了 e 志大英默写器。

本项目仅供学习交流使用，主要面向浙江大学校内学生进行非商业共享。项目不会出售软件或词书，也没有商业使用计划。

book2、book3 词书目前没有一份格式规范、可公开核验的书面授权。原项目仓库页面也没有明确的软件许可证声明，因此这里不为原项目代码或词书写入未经确认的许可证。非商业用途不能代替版权许可。如果原作者或相关权利人对仓库内容有疑问，请通过 Issues 联系；核实后会及时补充说明、调整范围或移除相关内容。

## 反馈

功能还在持续检查。如果你发现问题，请尽量说明操作步骤、预期结果和实际结果。可以通过 Issues 反馈，也欢迎提交 Pull Request。
