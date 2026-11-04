const messageElement = document.querySelector("#connection-message");
const indicatorElement = document.querySelector("#connection-indicator");
const buttonElement = document.querySelector("#check-connection-button");

async function checkConnection() {
  buttonElement.disabled = true;
  messageElement.textContent = "Checking API and database...";
  indicatorElement.className = "status-indicator";

  try {
    const response = await fetch("/api/health");
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "The server returned an error.");
    }

    messageElement.textContent = `${data.message} PostgreSQL: ${data.database}.`;
    indicatorElement.className = "status-indicator online";
  } catch (error) {
    messageElement.textContent = `Connection failed: ${error.message}`;
    indicatorElement.className = "status-indicator offline";
  } finally {
    buttonElement.disabled = false;
  }
}

buttonElement.addEventListener("click", checkConnection);
checkConnection();
