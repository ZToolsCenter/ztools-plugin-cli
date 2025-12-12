/// <reference types="@ztools-center/ztools-api-types" />

window.ztools.onPluginEnter(({ code, type, payload }) => {
  console.log('Plugin entered:', code, type, payload)

  if (code === 'hello') {
    window.ztools.showNotification('Hello from ZTools!')
    window.ztools.hideMainWindow()
  }
})
