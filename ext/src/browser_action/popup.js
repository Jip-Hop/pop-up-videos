var tabId;

chrome.runtime.onMessage.addListener(function(message) {
  if (message.type === "tabState") {
    tabId = message.tabId;
    if (message.enabled) {
      document.querySelectorAll(".enabled").forEach(element => {
        element.style.display = "block";
      });
      document.querySelectorAll(".disabled").forEach(element => {
        element.style.display = "none";
      });
    } else {
      document.querySelectorAll(".disabled").forEach(element => {
        element.style.display = "block";
      });
      document.querySelectorAll(".enabled").forEach(element => {
        element.style.display = "none";
      });
    }
  }
});

chrome.runtime.sendMessage({ type: "popupLoad" });

document.querySelectorAll("button").forEach(button => {
  button.onclick = () => {
    chrome.runtime.sendMessage({ type: button.id, tabId: tabId });
  };
});
