
(function(){

let engine, render, runner;
let currentType = 0;
let score = 0;
let gameOverState = false;

const TYPES = [
    { radius: 22, color: "#6EE7B7", points: 1 },
    { radius: 28, color: "#60A5FA", points: 2 },
    { radius: 34, color: "#F472B6", points: 4 },
    { radius: 42, color: "#F59E0B", points: 8 },
    { radius: 52, color: "#A78BFA", points: 16 }
];

function initMergeGame(containerId){

    const { Engine, Render, Runner, Bodies, Composite, Events } = Matter;

    engine = Engine.create();
    engine.gravity.y = 1;

    const container = document.getElementById(containerId);
    container.innerHTML = "";

    const width = container.clientWidth;
    const height = container.clientHeight;

    render = Render.create({
        element: container,
        engine: engine,
        options: {
            width: width,
            height: height,
            wireframes: false,
            background: "#111827"
        }
    });

    const ground = Bodies.rectangle(width/2, height+30, width, 60, { isStatic: true });
    const leftWall = Bodies.rectangle(-30, height/2, 60, height, { isStatic: true });
    const rightWall = Bodies.rectangle(width+30, height/2, 60, height, { isStatic: true });

    Composite.add(engine.world, [ground, leftWall, rightWall]);

    Runner.run(Runner.create(), engine);
    Render.run(render);

    container.addEventListener("click", function(e){
        if(gameOverState) return;
        spawnItem(e.offsetX);
    });

    Events.on(engine, "collisionStart", function(event){
        event.pairs.forEach(pair => {
            const a = pair.bodyA;
            const b = pair.bodyB;

            if(a.label === "mergeItem" && b.label === "mergeItem" && a.typeIndex === b.typeIndex){
                mergeBodies(a,b);
            }
        });
    });

    Events.on(engine, "afterUpdate", checkGameOver);
}

function spawnItem(x){

    const { Bodies, Composite } = Matter;

    const type = TYPES[currentType];
    const body = Bodies.circle(x, 50, type.radius, {
        restitution: 0.2,
        friction: 0.3,
        render: { fillStyle: type.color },
        label: "mergeItem"
    });

    body.typeIndex = currentType;

    Composite.add(engine.world, body);

    currentType = Math.floor(Math.random()*2);
}

function mergeBodies(a,b){

    if(gameOverState) return;

    const { Composite, Bodies } = Matter;

    if(a.typeIndex >= TYPES.length-1) return;

    const newIndex = a.typeIndex + 1;
    const newType = TYPES[newIndex];

    const newBody = Bodies.circle(
        (a.position.x + b.position.x)/2,
        (a.position.y + b.position.y)/2,
        newType.radius,
        {
            restitution: 0.2,
            friction: 0.3,
            render: { fillStyle: newType.color },
            label: "mergeItem"
        }
    );

    newBody.typeIndex = newIndex;

    Composite.remove(engine.world, a);
    Composite.remove(engine.world, b);
    Composite.add(engine.world, newBody);

    score += newType.points;
}

function checkGameOver(){

    const bodies = Matter.Composite.allBodies(engine.world);

    for(let body of bodies){
        if(body.label === "mergeItem"){
            if(body.position.y < 120 && body.speed < 0.5){
                triggerGameOver();
                break;
            }
        }
    }
}

function triggerGameOver(){
    gameOverState = true;
    alert("Game Over");
}

window.initMergeGame = initMergeGame;

})();
