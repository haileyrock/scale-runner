// Game Constants
const CANVAS_WIDTH = 900;
const CANVAS_HEIGHT = 700;
const PLATFORM_COUNT = 7;
const PLATFORM_HEIGHT = 70;
const PLATFORM_Y_START = 50;

const NOTE_COLORS = {
    'Do': '#ff4444',
    'Re': '#ff8844',
    'Mi': '#ffdd44',
    'Fa': '#44ff44',
    'So': '#4444ff',
    'La': '#8844ff',
    'Ti': '#ff44ff',
    'Do\'': '#ff0000'
};

const NOTE_PITCHES = {
    'Do': 'C4',
    'Re': 'D4',
    'Mi': 'E4',
    'Fa': 'F4',
    'So': 'G4',
    'La': 'A4',
    'Ti': 'B4',
    'Do\'': 'C5'
};

// Game State
let canvas, ctx;
let gameState = 'start';
let player;
let platforms = [];
let notePanels = [];
let enemies = [];
let ladders = [];
let particles = [];
let plates = []; // Bottom plates where scales complete
let score = 0;
let level = 1;
let lives = 3;
let pepperSprayCount = 5;
let pepperSprayCooldown = 0;
let pepperSprayParticles = [];
let keys = {};
let synth;
let enemySpawnTimer = 0;
let enemySpawnDelay = 180;

// Initialize game
function init() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');

    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;

    // Setup audio - will be initialized on first user interaction
    synth = null;

    // Event listeners
    document.getElementById('start-button').addEventListener('click', startGame);
    document.getElementById('restart-button').addEventListener('click', restartGame);
    
    document.addEventListener('keydown', (e) => {
        keys[e.key] = true;
        if (e.key === ' ' || e.key.startsWith('Arrow')) {
            e.preventDefault();
        }
    });
    document.addEventListener('keyup', (e) => keys[e.key] = false);
}

// Player Class
class Player {
    constructor() {
        this.width = 30;
        this.height = 40;
        this.x = 100;
        this.platformIndex = PLATFORM_COUNT - 1;
        this.y = platforms[this.platformIndex].y - this.height;
        this.speed = 2.5;
        this.direction = 1;
        this.isOnLadder = false;
        this.currentLadder = null; // Track which ladder we're currently on
        this.climbSpeed = 2;
        this.invincible = false;
        this.invincibleTimer = 0;
    }

    update() {
        // Handle invincibility
        if (this.invincible) {
            this.invincibleTimer--;
            if (this.invincibleTimer <= 0) {
                this.invincible = false;
            }
        }

        // Handle pepper spray cooldown
        if (pepperSprayCooldown > 0) {
            pepperSprayCooldown--;
        }

        // Use pepper spray
        if (keys[' '] && pepperSprayCount > 0 && pepperSprayCooldown === 0) {
            this.usePepperSpray();
        }

        let moving = false;
        const playerCenterX = this.x + this.width / 2;

        // Find nearby ladder - stick to current ladder if already climbing
        let nearbyLadder = null;

        // If already on a ladder, keep using it
        if (this.isOnLadder && this.currentLadder) {
            nearbyLadder = this.currentLadder;
        } else {
            // Find a new ladder
            let closestDistance = Infinity;

            for (let ladder of ladders) {
                const ladderCenterX = ladder.x + ladder.width / 2;
                const horizontalDistance = Math.abs(playerCenterX - ladderCenterX);

                // Very lenient distance check - 100 pixels
                if (horizontalDistance < 100) {
                    // When on platform, find best ladder based on what we're trying to do
                    const canGoDown = (this.platformIndex === ladder.fromPlatform); // We're at top of this ladder
                    const canGoUp = (this.platformIndex === ladder.toPlatform); // We're at bottom of this ladder

                    // Prioritize based on button pressed
                    if (keys['ArrowDown'] && canGoDown && horizontalDistance < closestDistance) {
                        nearbyLadder = ladder;
                        closestDistance = horizontalDistance;
                    } else if (keys['ArrowUp'] && canGoUp && horizontalDistance < closestDistance) {
                        nearbyLadder = ladder;
                        closestDistance = horizontalDistance;
                    } else if (!keys['ArrowUp'] && !keys['ArrowDown'] && (canGoDown || canGoUp) && horizontalDistance < closestDistance) {
                        // Not pressing any arrow - just find closest usable ladder
                        nearbyLadder = ladder;
                        closestDistance = horizontalDistance;
                    }
                }
            }
        }

        // Ladder climbing
        if (nearbyLadder) {
            const onTopPlatform = this.platformIndex === nearbyLadder.fromPlatform;
            const onBottomPlatform = this.platformIndex === nearbyLadder.toPlatform;

            // Going up - must be on bottom platform or already climbing up
            if (keys['ArrowUp'] && (onBottomPlatform || (this.isOnLadder && this.y > nearbyLadder.y))) {
                this.isOnLadder = true;
                this.currentLadder = nearbyLadder; // Lock onto this ladder
                moving = true;

                // Snap to ladder center
                const targetX = nearbyLadder.x + nearbyLadder.width / 2 - this.width / 2;
                this.x += (targetX - this.x) * 0.2;

                this.y -= this.climbSpeed;
                // Reached top of ladder
                if (this.y <= nearbyLadder.y) {
                    this.platformIndex = nearbyLadder.fromPlatform;
                    this.y = platforms[this.platformIndex].y - this.height;
                    this.isOnLadder = false;
                    this.currentLadder = null; // Release ladder
                }
            }
            // Going down - must be on top platform or already climbing down
            if (keys['ArrowDown'] && (onTopPlatform || (this.isOnLadder && this.y < nearbyLadder.y + nearbyLadder.height))) {
                this.isOnLadder = true;
                this.currentLadder = nearbyLadder; // Lock onto this ladder
                moving = true;

                // Snap to ladder center
                const targetX = nearbyLadder.x + nearbyLadder.width / 2 - this.width / 2;
                this.x += (targetX - this.x) * 0.2;

                this.y += this.climbSpeed;

                // Reached bottom of ladder
                const bottomY = nearbyLadder.y + nearbyLadder.height;
                if (this.y + this.height >= bottomY) {
                    this.platformIndex = nearbyLadder.toPlatform;
                    this.y = platforms[this.platformIndex].y - this.height;
                    this.isOnLadder = false;
                    this.currentLadder = null; // Release ladder
                }
            }
            // If on ladder but not pressing keys, just stay on ladder (don't exit mid-climb)
        }

        // Horizontal movement - if pressing left/right, exit ladder mode and move horizontally
        if (keys['ArrowLeft'] || keys['ArrowRight']) {
            // Exit ladder mode if moving horizontally
            if (this.isOnLadder) {
                this.isOnLadder = false;
                this.currentLadder = null;
                // Snap to nearest platform
                let closestPlatform = 0;
                let closestDistance = Infinity;
                for (let i = 0; i < platforms.length; i++) {
                    const distance = Math.abs(this.y + this.height - platforms[i].y);
                    if (distance < closestDistance) {
                        closestDistance = distance;
                        closestPlatform = i;
                    }
                }
                this.platformIndex = closestPlatform;
                this.y = platforms[this.platformIndex].y - this.height;
            }

            const currentPlatform = platforms[this.platformIndex];

            if (keys['ArrowLeft']) {
                this.x -= this.speed;
                this.direction = -1;
                moving = true;
            }
            if (keys['ArrowRight']) {
                this.x += this.speed;
                this.direction = 1;
                moving = true;
            }

            // Keep on platform
            this.x = Math.max(currentPlatform.x, Math.min(this.x, currentPlatform.x + currentPlatform.width - this.width));
        } else if (!this.isOnLadder) {
            // Not on ladder and not moving - just stay on current platform
            const currentPlatform = platforms[this.platformIndex];
            this.y = currentPlatform.y - this.height;
        }

        // Check note panel walking
        if (moving && !this.isOnLadder) {
            this.checkNotePanelWalking();
        }

        // Check collision with enemies
        if (!this.invincible) {
            this.checkEnemyCollision();
        }
    }

    checkNotePanelWalking() {
        for (let panel of notePanels) {
            if (panel.dropped || panel.falling) continue;
            if (panel.platformIndex !== this.platformIndex) continue;

            const panelLeft = panel.x;
            const panelRight = panel.x + panel.width;
            const playerCenterX = this.x + this.width / 2;

            // Player is walking on the panel
            if (playerCenterX >= panelLeft && playerCenterX <= panelRight) {
                panel.walkOver(playerCenterX);
            }
        }
    }

    checkEnemyCollision() {
        for (let enemy of enemies) {
            // Skip stunned enemies - player is safe from them
            if (enemy.stunned) continue;

            const dx = Math.abs((this.x + this.width / 2) - (enemy.x + enemy.width / 2));
            const dy = Math.abs((this.y + this.height / 2) - (enemy.y + enemy.height / 2));

            if (dx < (this.width + enemy.width) / 2 && dy < (this.height + enemy.height) / 2) {
                this.die();
                return;
            }
        }
    }

    die() {
        lives--;
        if (lives <= 0) {
            gameOver();
        } else {
            // Reset position with invincibility
            this.platformIndex = PLATFORM_COUNT - 1;
            this.x = 100;
            this.y = platforms[this.platformIndex].y - this.height;
            this.isOnLadder = false;
            this.direction = 1;
            this.invincible = true;
            this.invincibleTimer = 120; // 2 seconds at 60fps

            // Clear nearby enemies
            enemies = enemies.filter(enemy => {
                const dist = Math.abs(enemy.x - this.x);
                return dist > 200;
            });
        }
    }

    usePepperSpray() {
        pepperSprayCount--;
        pepperSprayCooldown = 30; // 0.5 second cooldown

        // Create pepper spray effect
        const sprayDirection = this.direction;
        const sprayX = this.x + (sprayDirection > 0 ? this.width : 0);
        const sprayY = this.y + this.height / 2;

        // Create spray particles
        for (let i = 0; i < 15; i++) {
            const angle = (Math.random() - 0.5) * Math.PI / 3; // 60 degree cone
            const speed = 3 + Math.random() * 2;
            pepperSprayParticles.push({
                x: sprayX,
                y: sprayY,
                vx: Math.cos(angle) * speed * sprayDirection,
                vy: Math.sin(angle) * speed,
                life: 20,
                size: 2 + Math.random() * 2
            });
        }

        // Check for enemies in range
        enemies.forEach(enemy => {
            if (enemy.stunned) return;

            const dx = enemy.x + enemy.width / 2 - (this.x + this.width / 2);
            const dy = Math.abs(enemy.y - this.y);

            // Check if enemy is in front and in range
            if ((sprayDirection > 0 && dx > 0 && dx < 100) ||
                (sprayDirection < 0 && dx < 0 && dx > -100)) {
                if (dy < 30) {
                    enemy.stun();
                    score += 50;
                }
            }
        });
    }

    draw() {
        const centerX = this.x + this.width / 2;

        // Body (chef's outfit)
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x + 6, this.y + 14, 18, 22);

        // Head
        ctx.fillStyle = '#ffdbac';
        ctx.beginPath();
        ctx.arc(centerX, this.y + 8, 7, 0, Math.PI * 2);
        ctx.fill();

        // Chef hat
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x + 7, this.y + 1, 16, 5);
        ctx.fillRect(this.x + 9, this.y - 3, 12, 4);

        // Arms
        ctx.strokeStyle = '#ffdbac';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(this.x + 6, this.y + 18);
        ctx.lineTo(this.x + 2, this.y + 25);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(this.x + 24, this.y + 18);
        ctx.lineTo(this.x + 28, this.y + 25);
        ctx.stroke();

        // Legs
        ctx.strokeStyle = '#0066cc';
        ctx.beginPath();
        ctx.moveTo(centerX - 3, this.y + 36);
        ctx.lineTo(centerX - 4, this.y + this.height);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(centerX + 3, this.y + 36);
        ctx.lineTo(centerX + 4, this.y + this.height);
        ctx.stroke();
    }
}

// Platform Class
class Platform {
    constructor(y, index, width, x) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = 8;
        this.index = index;
    }

    draw() {
        ctx.fillStyle = '#654321';
        ctx.fillRect(this.x, this.y - 4, this.width, this.height);
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x, this.y - 4, this.width, this.height);
    }
}

// NotePanel Class - like burger pieces
class NotePanel {
    constructor(x, platformIndex, note, plateIndex, noteIndex) {
        this.platformIndex = platformIndex;
        this.note = note;
        this.plateIndex = plateIndex;
        this.noteIndex = noteIndex; // Position in scale (0-4)
        this.width = 120;
        this.height = 16;

        // Ensure note is always positioned correctly on the platform
        const platform = platforms[platformIndex];

        // Clamp x position to be within platform bounds with 10px margin on each side
        this.x = Math.max(platform.x + 10, Math.min(x, platform.x + platform.width - this.width - 10));

        // Position note on top of platform
        this.y = platform.y - this.height - 5;
        
        // Track walked sections (left, middle, right)
        this.sections = [false, false, false, false];
        this.sectionWidth = this.width / 4;
        
        this.falling = false;
        this.fallSpeed = 0;
        this.dropped = false;
        this.carriedEnemies = [];
    }

    walkOver(playerX) {
        // Don't allow walking over notes that are already dropped or falling
        if (this.dropped || this.falling) return;

        // Determine which section the player is in
        const relativeX = playerX - this.x;
        const sectionIndex = Math.floor(relativeX / this.sectionWidth);

        if (sectionIndex >= 0 && sectionIndex < 4 && !this.sections[sectionIndex]) {
            this.sections[sectionIndex] = true;
            playNote(this.note, 0.5);
            score += 10;

            // Create particle effect
            createParticles(playerX, this.y + this.height / 2, NOTE_COLORS[this.note]);

            // Check if all sections walked
            if (this.sections.every(s => s)) {
                this.startFalling();
            }
        }
    }

    startFalling() {
        this.falling = true;
        this.fallSpeed = 4;
        score += 50;
        
        // Check for enemies on this panel
        this.carriedEnemies = enemies.filter(enemy => {
            return !enemy.falling &&
                   enemy.platformIndex === this.platformIndex &&
                   enemy.x + enemy.width > this.x &&
                   enemy.x < this.x + this.width;
        });
        
        // Mark carried enemies as falling
        this.carriedEnemies.forEach(enemy => {
            enemy.falling = true;
            enemy.carriedByPanel = this;
        });
    }

    update() {
        if (!this.falling) return;

        this.y += this.fallSpeed;

        // Move carried enemies with panel
        this.carriedEnemies.forEach(enemy => {
            enemy.y = this.y - enemy.height;
        });

        // Check if fell to bottom (check early for notes on bottom platform)
        if (this.y + this.height >= CANVAS_HEIGHT - 60) {
            this.checkPlateCollision();
            return;
        }

        // Check if hit the next platform or a note panel below
        let hitSomething = false;

        // Check platforms (only if there are platforms below)
        for (let i = this.platformIndex + 1; i < platforms.length; i++) {
            const platform = platforms[i];
            if (this.y + this.height >= platform.y) {
                this.y = platform.y - this.height - 5;
                this.platformIndex = i;
                // Clamp x position to new platform bounds with 10px margin
                this.x = Math.max(platform.x + 10, Math.min(this.x, platform.x + platform.width - this.width - 10));
                hitSomething = true;
                break;
            }
        }

        // Check other note panels below
        if (!hitSomething) {
            for (let panel of notePanels) {
                if (panel === this || panel.falling) continue;
                if (panel.platformIndex > this.platformIndex &&
                    this.y + this.height >= panel.y &&
                    Math.abs(this.x - panel.x) < this.width / 2) {

                    this.y = panel.y - this.height;
                    this.platformIndex = panel.platformIndex;

                    // Clamp x position to platform bounds with 10px margin
                    const platform = platforms[this.platformIndex];
                    this.x = Math.max(platform.x + 10, Math.min(this.x, platform.x + platform.width - this.width - 10));

                    hitSomething = true;

                    // Push the panel below
                    if (!panel.falling && panel.sections.every(s => s)) {
                        panel.startFalling();
                    }
                    break;
                }
            }
        }

        if (hitSomething) {
            this.falling = false;
            this.fallSpeed = 0;

            // Reset sections so the note can be walked on again
            this.sections = [false, false, false, false];

            // Release carried enemies
            this.carriedEnemies.forEach(enemy => {
                enemy.falling = false;
                enemy.carriedByPanel = null;
                enemy.platformIndex = this.platformIndex;
                enemy.y = platforms[enemy.platformIndex].y - enemy.height;
                score += 100; // Bonus for dropping enemy
            });
            this.carriedEnemies = [];

            // Check if landed in plate
            this.checkPlateCollision();
        }
    }

    checkPlateCollision() {
        const plate = plates[this.plateIndex];
        const plateY = CANVAS_HEIGHT - 30; // Keep buckets at bottom

        // Check if this panel is at the bottom and in correct plate
        if (this.y + this.height >= plateY - 10) {
            const plateCenterX = plate.x + plate.width / 2;
            const panelCenterX = this.x + this.width / 2;

            // More lenient collision - if note is anywhere over the plate
            if (Math.abs(plateCenterX - panelCenterX) < plate.width / 2 + this.width / 2) {
                // Snap to plate - stack more compactly with 1px spacing
                this.x = plateCenterX - this.width / 2;
                this.y = plateY - (plate.notes.length + 1) * (this.height + 1);
                this.dropped = true;
                this.falling = false;

                plate.addNote(this);
            } else {
                // Note missed the plate - stop it from falling further
                this.falling = false;
                this.y = CANVAS_HEIGHT - 30;
            }
        }
    }

    draw() {
        // Ensure stationary notes stay on platform
        if (!this.falling && !this.dropped) {
            const platform = platforms[this.platformIndex];
            this.y = platform.y - this.height - 5;
        }

        // Main note body
        ctx.fillStyle = NOTE_COLORS[this.note];
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        // Draw sections with darker color if not walked
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) {
            const sectionX = this.x + i * this.sectionWidth;
            if (!this.sections[i]) {
                ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
                ctx.fillRect(sectionX, this.y, this.sectionWidth, this.height);
            }
            ctx.strokeRect(sectionX, this.y, this.sectionWidth, this.height);
        }
        
        // Note name
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(this.note, this.x + this.width / 2, this.y + this.height - 3);
    }
}

// Ladder Class
class Ladder {
    constructor(x, fromPlatform, toPlatform) {
        this.x = x;
        this.width = 30;
        this.fromPlatform = fromPlatform;
        this.toPlatform = toPlatform;
        this.y = platforms[fromPlatform].y;
        this.height = platforms[toPlatform].y - platforms[fromPlatform].y;
    }

    draw() {
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = 3;
        
        // Side rails
        ctx.beginPath();
        ctx.moveTo(this.x + 5, this.y);
        ctx.lineTo(this.x + 5, this.y + this.height);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.moveTo(this.x + 25, this.y);
        ctx.lineTo(this.x + 25, this.y + this.height);
        ctx.stroke();
        
        // Rungs
        const rungCount = Math.floor(this.height / 15);
        for (let i = 0; i <= rungCount; i++) {
            const rungY = this.y + (this.height / rungCount) * i;
            ctx.beginPath();
            ctx.moveTo(this.x + 5, rungY);
            ctx.lineTo(this.x + 25, rungY);
            ctx.stroke();
        }
    }
}

// Enemy Class (like the hot dogs in BurgerTime)
class Enemy {
    constructor(platformIndex) {
        this.width = 25;
        this.height = 30;
        this.platformIndex = platformIndex;
        const platform = platforms[platformIndex];
        this.x = platform.x + Math.random() * (platform.width - this.width);
        this.y = platform.y - this.height;
        // Increase speed with each level - starts at 1.2, increases by 0.15 per level
        this.speed = 1.2 + (level - 1) * 0.15;
        this.direction = Math.random() > 0.5 ? 1 : -1;
        this.isOnLadder = false;
        this.falling = false;
        this.carriedByPanel = null;
        this.chaseTimer = 0;
        this.stunned = false;
        this.stunTimer = 0;
    }

    update() {
        if (this.falling) return;

        // Handle stun
        if (this.stunned) {
            this.stunTimer--;
            if (this.stunTimer <= 0) {
                this.stunned = false;
            }
            return; // Don't move while stunned
        }

        const platform = platforms[this.platformIndex];
        
        // Simple AI - move toward player occasionally
        this.chaseTimer++;
        if (this.chaseTimer > 60) {
            this.chaseTimer = 0;
            if (Math.random() > 0.3 && this.platformIndex === player.platformIndex) {
                this.direction = player.x > this.x ? 1 : -1;
            }
        }
        
        // Move horizontally
        this.x += this.speed * this.direction;
        
        // Bounce at platform edges
        if (this.x < platform.x) {
            this.x = platform.x;
            this.direction = 1;
        }
        if (this.x + this.width > platform.x + platform.width) {
            this.x = platform.x + platform.width - this.width;
            this.direction = -1;
        }
        
        // Sometimes use ladders
        if (Math.random() < 0.01) {
            this.tryUseLadder();
        }
        
        this.y = platform.y - this.height;
    }

    tryUseLadder() {
        const enemyCenterX = this.x + this.width / 2;
        
        for (let ladder of ladders) {
            const ladderCenterX = ladder.x + ladder.width / 2;
            if (Math.abs(enemyCenterX - ladderCenterX) < 20) {
                if (ladder.fromPlatform === this.platformIndex && Math.random() > 0.5) {
                    this.platformIndex = ladder.toPlatform;
                    return;
                } else if (ladder.toPlatform === this.platformIndex) {
                    this.platformIndex = ladder.fromPlatform;
                    return;
                }
            }
        }
    }

    stun() {
        this.stunned = true;
        this.stunTimer = 90; // 1.5 seconds stun
    }

    draw() {
        // Enemy (musical dissonance character)
        ctx.fillStyle = this.stunned ? '#ffaa00' : '#cc0000';
        ctx.fillRect(this.x + 5, this.y + 8, 15, 20);
        
        // Head
        ctx.fillStyle = '#990000';
        ctx.beginPath();
        ctx.arc(this.x + this.width / 2, this.y + 6, 6, 0, Math.PI * 2);
        ctx.fill();
        
        // Eyes
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(this.x + 8, this.y + 4, 3, 3);
        ctx.fillRect(this.x + 14, this.y + 4, 3, 3);
        
        // Sharp symbol
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('♯', this.x + this.width / 2, this.y + 23);
    }
}

// Plate Class (like the plates at bottom in BurgerTime)
class Plate {
    constructor(x, plateIndex) {
        this.x = x;
        this.plateIndex = plateIndex;
        this.width = 140;
        this.height = 20;
        this.y = CANVAS_HEIGHT - 30; // Keep at bottom of screen
        this.notes = [];
        this.complete = false;
    }

    addNote(notePanel) {
        if (!this.notes.find(n => n === notePanel)) {
            this.notes.push(notePanel);
            
            if (this.notes.length === 8) {
                this.complete = true;
                score += 500;
                playHarmony();
                createHarmonyEffect(this.x + this.width / 2, this.y - 40);
                checkLevelComplete();
            }
        }
    }

    draw() {
        // Plate base
        ctx.fillStyle = this.complete ? '#FFD700' : '#999999';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 2;
        ctx.strokeRect(this.x, this.y, this.width, this.height);
        
        // Plate label
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(`Scale ${this.plateIndex + 1}`, this.x + this.width / 2, this.y + 14);
    }
}

// Particle Class
class Particle {
    constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4;
        this.color = color;
        this.life = 30;
        this.size = Math.random() * 3 + 2;
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.2;
        this.life--;
    }

    draw() {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = this.life / 30;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    }
}

// Game Functions
function startGame() {
    document.getElementById('start-screen').classList.add('hidden');
    gameState = 'playing';

    // Initialize audio on first user interaction
    if (!synth) {
        synth = new Tone.PolySynth(Tone.Synth, {
            oscillator: { type: 'sine' },
            envelope: {
                attack: 0.05,
                decay: 0.2,
                sustain: 0.3,
                release: 0.5
            }
        }).toDestination();
        Tone.start(); // Start audio context
    }

    score = 0;
    level = 1;
    lives = 3;
    pepperSprayCount = 5;
    pepperSprayCooldown = 0;
    pepperSprayParticles = [];
    enemySpawnTimer = 0;

    createLevel();
    gameLoop();
}

function restartGame() {
    document.getElementById('game-over-screen').classList.add('hidden');
    startGame();
}

function createLevel() {
    platforms = [];
    notePanels = [];
    enemies = [];
    ladders = [];
    particles = [];
    plates = [];
    
    // Create platforms (BurgerTime style - varying widths)
    const platformConfigs = [
        { width: 800, x: 50 },    // Top
        { width: 600, x: 150 },
        { width: 700, x: 100 },
        { width: 500, x: 200 },
        { width: 650, x: 125 },
        { width: 550, x: 175 },
        { width: 800, x: 50 }     // Bottom
    ];
    
    for (let i = 0; i < PLATFORM_COUNT; i++) {
        const y = PLATFORM_Y_START + i * PLATFORM_HEIGHT;
        const config = platformConfigs[i];
        platforms.push(new Platform(y, i, config.width, config.x));
    }
    
    // Create three plates at bottom
    const platePositions = [150, 380, 610];
    for (let i = 0; i < 3; i++) {
        plates.push(new Plate(platePositions[i], i));
    }
    
    // Create note panels - 8 notes per plate = 24 total
    const notes = ['Do', 'Re', 'Mi', 'Fa', 'So', 'La', 'Ti', 'Do\''];

    for (let plateIdx = 0; plateIdx < 3; plateIdx++) {
        const plate = plates[plateIdx];
        const plateCenterX = plate.x + plate.width / 2;

        for (let noteIdx = 0; noteIdx < 8; noteIdx++) {
            // Place on platforms (platforms 1-6, including bottom)
            const platformIndex = 1 + Math.floor(Math.random() * 6);
            const platform = platforms[platformIndex];

            // Position note to align with its target plate (with some variation)
            const noteWidth = 120;
            const variation = (Math.random() - 0.5) * 40; // +/- 20 pixels variation
            let x = plateCenterX - noteWidth / 2 + variation;

            // Ensure note stays within platform bounds
            x = Math.max(platform.x + 20, Math.min(x, platform.x + platform.width - noteWidth - 20));

            notePanels.push(new NotePanel(x, platformIndex, notes[noteIdx], plateIdx, noteIdx));
        }
    }
    
    // Create ladders
    for (let i = 0; i < PLATFORM_COUNT - 1; i++) {
        const platform = platforms[i];
        const nextPlatform = platforms[i + 1];
        
        // 2 ladders per level
        const ladderCount = 2;
        for (let j = 0; j < ladderCount; j++) {
            const minX = Math.max(platform.x, nextPlatform.x) + 40;
            const maxX = Math.min(platform.x + platform.width, nextPlatform.x + nextPlatform.width) - 70;
            
            if (maxX > minX) {
                const x = minX + ((maxX - minX) / (ladderCount + 1)) * (j + 1);
                ladders.push(new Ladder(x, i, i + 1));
            }
        }
    }
    
    // Initialize player
    player = new Player();

    // Start with enemies spread across different platforms
    // More enemies on higher levels
    const initialEnemies = Math.min(2 + Math.floor(level / 2), 5);

    // Calculate spawn range - higher levels spawn lower (closer to player)
    // Level 1: platforms 1-3, Level 2: platforms 2-4, Level 3+: platforms 3-5
    const minPlatform = Math.min(level, 3);
    const maxPlatform = Math.min(level + 2, 5);

    for (let i = 0; i < initialEnemies; i++) {
        // Spread enemies across the level-appropriate platform range
        const platformRange = maxPlatform - minPlatform + 1;
        const platformIndex = minPlatform + (i % platformRange);
        enemies.push(new Enemy(platformIndex));
    }
}

function checkLevelComplete() {
    if (plates.every(plate => plate.complete)) {
        score += 1000 * level;
        level++;
        
        setTimeout(() => {
            createLevel();
        }, 2000);
    }
}

function createParticles(x, y, color) {
    for (let i = 0; i < 8; i++) {
        particles.push(new Particle(x, y, color));
    }
}

function createHarmonyEffect(x, y) {
    for (let i = 0; i < 30; i++) {
        const angle = (Math.PI * 2 * i) / 30;
        const px = x + Math.cos(angle) * 20;
        const py = y + Math.sin(angle) * 20;
        particles.push(new Particle(px, py, '#FFD700'));
    }
}

function gameOver() {
    gameState = 'gameover';
    document.getElementById('final-score').textContent = `Score: ${score}`;
    document.getElementById('final-level').textContent = `Level: ${level}`;
    document.getElementById('game-over-screen').classList.remove('hidden');
}

// Audio Functions
function playNote(note, volume = 0.6) {
    if (!synth) return; // Don't play if audio not initialized
    const pitch = NOTE_PITCHES[note];
    synth.triggerAttackRelease(pitch, '0.3', undefined, volume);
}

function playHarmony() {
    if (!synth) return; // Don't play if audio not initialized
    const chord = ['C4', 'E4', 'G4', 'C5'];
    synth.triggerAttackRelease(chord, '1.2');
}

// Game Loop
function gameLoop() {
    if (gameState !== 'playing') return;
    
    // Clear canvas
    const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
    gradient.addColorStop(0, '#0a0a2e');
    gradient.addColorStop(1, '#1a1a3e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // Update
    player.update();
    
    notePanels.forEach(panel => {
        if (panel.falling) panel.update();
    });
    
    enemies.forEach(enemy => enemy.update());
    
    particles = particles.filter(p => {
        p.update();
        return p.life > 0;
    });

    // Update pepper spray particles
    pepperSprayParticles = pepperSprayParticles.filter(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life--;
        return p.life > 0;
    });

    // Spawn enemies gradually
    enemySpawnTimer++;
    const maxEnemies = Math.min(2 + Math.floor(level / 2), 5);

    // Decrease spawn delay on higher levels for more frequent spawning
    const adjustedSpawnDelay = Math.max(enemySpawnDelay - (level - 1) * 20, 60);

    if (enemySpawnTimer > adjustedSpawnDelay && enemies.length < maxEnemies) {
        enemySpawnTimer = 0;

        // Calculate spawn range - higher levels spawn lower (closer to player)
        const minPlatform = Math.min(level, 3);
        const maxPlatform = Math.min(level + 2, 5);
        const platformIndex = minPlatform + Math.floor(Math.random() * (maxPlatform - minPlatform + 1));

        enemies.push(new Enemy(platformIndex));
    }
    
    // Draw
    plates.forEach(plate => plate.draw());
    platforms.forEach(platform => platform.draw());
    ladders.forEach(ladder => ladder.draw());
    notePanels.forEach(panel => panel.draw());
    enemies.forEach(enemy => enemy.draw());
    particles.forEach(p => p.draw());

    // Draw pepper spray particles
    pepperSprayParticles.forEach(p => {
        ctx.fillStyle = 'rgba(255, 100, 0, ' + (p.life / 20) + ')';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    });

    player.draw();

    // Draw HUD
    drawHUD();
    
    requestAnimationFrame(gameLoop);
}

function drawHUD() {
    ctx.fillStyle = 'white';
    ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left';
    
    ctx.fillText(`Score: ${score}`, 10, 25);
    ctx.fillText(`Level: ${level}`, 10, 45);
    
    ctx.fillStyle = '#ff4444';
    ctx.fillText(`Lives: ${'♥'.repeat(lives)}`, 200, 25);

    ctx.fillStyle = '#ff6600';
    ctx.fillText(`Pepper: ${pepperSprayCount}`, 200, 45);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '13px Arial';
    ctx.fillText('Walk over all 4 sections of each note to drop it', 10, CANVAS_HEIGHT - 30);
    ctx.fillText('Press SPACE to use pepper spray', 10, CANVAS_HEIGHT - 10);
}

// Initialize on load
window.addEventListener('load', init);
