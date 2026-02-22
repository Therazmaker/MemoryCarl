window.addEventListener("load", () => {

  console.log("🫧 NeuroBubble booting...");

  const bubble = document.createElement("div");
  bubble.id = "neuroBubble";
  bubble.style.position = "fixed";
  bubble.style.left = "0";
  bubble.style.top = "0";
  bubble.style.width = "56px";
  bubble.style.height = "56px";
  bubble.style.borderRadius = "50%";
  bubble.style.background = "radial-gradient(circle at 30% 30%, #ffffffcc, #66ccff)";
  bubble.style.boxShadow = "0 0 12px #66ccff66";
  bubble.style.zIndex = "999999";
  bubble.style.opacity = "0.95";
  bubble.style.transition = "transform 0.2s ease-out";
  bubble.style.transform = "translate(200px, 200px)";

  bubble.innerHTML = `
    <div style="display:flex;justify-content:space-around;margin-top:16px;">
      <div style="width:12px;height:12px;background:white;border-radius:50%;position:relative;">
        <div style="width:6px;height:6px;background:black;border-radius:50%;position:absolute;top:3px;left:3px;"></div>
      </div>
      <div style="width:12px;height:12px;background:white;border-radius:50%;position:relative;">
        <div style="width:6px;height:6px;background:black;border-radius:50%;position:absolute;top:3px;left:3px;"></div>
      </div>
    </div>
    <div style="width:16px;height:6px;background:black;border-radius:0 0 16px 16px;margin:4px auto;"></div>
  `;

  document.body.appendChild(bubble);

  console.log("🫧 NeuroBubble mounted.");
});
