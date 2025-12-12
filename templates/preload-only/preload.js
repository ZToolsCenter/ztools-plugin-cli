// ZTools Preload Script
// 运行在 Node.js 环境，可以使用 Node.js API

// 监听插件进入事件
window.ztools.onPluginEnter(({ code, type, payload }) => {
  console.log('Plugin entered:', code, type, payload)

  // 根据不同的 code 执行不同操作
  if (code === 'hello') {
    window.ztools.showNotification('Hello from ZTools!')
    window.ztools.hideMainWindow()
  }
})
