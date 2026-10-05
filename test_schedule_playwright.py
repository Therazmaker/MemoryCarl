import time
import subprocess
from playwright.sync_api import sync_playwright

# Start python http server if not running
server_proc = subprocess.Popen(["python3", "-m", "http.server", "8000"])
time.sleep(1)

try:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 412, "height": 915})
        page.goto("http://localhost:8000")
        page.wait_for_selector("#app")

        # Navigate to Semana / Schedule module
        # Click on schedule tab or bottom nav if available
        # In main.js schedule is accessed via / or state.tab="semana" or clicking on "Semana" button
        # Let's open schedule tab via JS
        page.evaluate("() => { state.tab = 'semana'; view(); }")
        page.wait_for_timeout(500)

        # Click on Add schedule item button for lunes/desayuno
        add_btn = page.query_selector('.btnAddScheduleItem[data-day="lunes"][data-slot="desayuno"]')
        if add_btn:
            add_btn.click()
            page.wait_for_timeout(500)

        page.screenshot(path="schedule_modal_verified.png")
        print("Screenshot saved to schedule_modal_verified.png")
        browser.close()
finally:
    server_proc.terminate()
