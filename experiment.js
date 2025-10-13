// Global variables
let trialData = [];
let currentTrialIndex = 0;
let currentTrial = null;
let revealedWords = new Set();
let startTime = null;
let clickTimes = [];
let randomSeed = null;

// Articles that should not be obscured
const articles = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];

// Get URL parameters
function getURLParameter(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

// Seeded random number generator (for reproducible randomization)
class SeededRandom {
    constructor(seed) {
        this.seed = seed;
    }
    
    // Linear congruential generator
    next() {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
    
    // Shuffle array using Fisher-Yates with seeded random
    shuffle(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }
}

// Determine which sublist to use based on URL parameter
// Default to sublist 1 if no parameter or invalid parameter
const sublistParam = getURLParameter('sublist');
let sublistNumber = 1; // default

if (sublistParam) {
    const parsed = parseInt(sublistParam);
    if (parsed >= 1 && parsed <= 4) {
        sublistNumber = parsed;
    } else {
        console.warn(`Invalid sublist parameter: ${sublistParam}. Using default sublist 1.`);
    }
}

// Get random seed from URL parameter (for trial randomization)
const seedParam = getURLParameter('seed');
if (seedParam) {
    randomSeed = parseInt(seedParam);
    if (isNaN(randomSeed)) {
        // If seed is not a number, convert string to number
        randomSeed = seedParam.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    }
} else {
    // Generate random seed if not provided
    randomSeed = Math.floor(Math.random() * 1000000);
}

console.log(`Using sublist: ${sublistNumber}`);
console.log(`Using random seed: ${randomSeed}`);

const csvFilename = `trial_list_sublist_${sublistNumber}.csv`;

// Initialize jsPsych
const jsPsych = initJsPsych({});

// Initialize filename based on workerId, sublist, and seed
const subject_id = jsPsych.randomization.randomID(10);
const filename = `${subject_id}_sublist${sublistNumber}_seed${randomSeed}.csv`;

// Function to load and randomize CSV data
function loadTrialData() {
    return new Promise((resolve, reject) => {
        Papa.parse(csvFilename, {
            download: true,
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: function(results) {
                console.log('Loaded CSV data:', results.data);
                
                if (results.data.length === 0) {
                    reject(new Error('CSV file is empty'));
                    return;
                }
                
                const requiredColumns = ['passage_variant', 'jabber_passage', 'target_pos', 'target_word'];
                const firstRow = results.data[0];
                const missingColumns = requiredColumns.filter(col => !(col in firstRow));
                
                if (missingColumns.length > 0) {
                    reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
                    return;
                }
                
                // Store original data
                const originalData = results.data;
                
                // Randomize trial order using seeded random
                const rng = new SeededRandom(randomSeed);
                trialData = rng.shuffle(originalData);
                
                console.log(`Successfully loaded ${trialData.length} trials from sublist ${sublistNumber}`);
                console.log(`Randomized with seed ${randomSeed}`);
                
                // Log first few trial numbers to verify randomization
                console.log('Randomized trial order (first 5):', 
                    trialData.slice(0, 5).map(t => t.trial_number || 'N/A'));
                
                resolve();
            },
            error: function(error) {
                console.error('Error loading CSV:', error);
                reject(error);
            }
        });
    });
}

// Function to parse word_to_nonce mapping
function parseWordToNonce(trial) {
    let mapping = {};
    
    if (trial.word_to_nonce) {
        try {
            // Handle both JSON string and object
            if (typeof trial.word_to_nonce === 'string') {
                mapping = JSON.parse(trial.word_to_nonce);
            } else {
                mapping = trial.word_to_nonce;
            }
        } catch (e) {
            console.warn('Could not parse word_to_nonce:', e);
        }
    }
    
    return mapping;
}

// Function to create word reveal trial
function createWordRevealTrial(trialIndex) {
    const trial = trialData[trialIndex];
    
    // Parse the passages
    const realSentence = trial.passage_variant || trial.ground_truth_sentence || '';
    const jabberSentence = trial.jabber_passage || trial.nonsense_sentence || '';
    
    const realWords = realSentence.split(' ');
    const jabberWords = jabberSentence.split(' ');
    
    // Get target position - handle both 'target_pos' and 'target_word_index'
    const targetPos = trial.target_pos || trial.target_word_index;
    
    // Parse target position if it's a string like "noun" or a number
    let targetIndex;
    if (typeof targetPos === 'number') {
        targetIndex = targetPos;
    } else if (typeof targetPos === 'string') {
        // If it's a word like "noun", try to find the target word
        const targetWord = trial.target_word;
        targetIndex = realWords.findIndex(word => 
            word.toLowerCase().replace(/[.,!?;:]/g, '') === targetWord.toLowerCase()
        );
    }
    
    const trialNumber = trialIndex + 1; // Use position in randomized order
    const originalTrialNumber = trial.trial_number || trialNumber;
    
    // Get word-to-nonce mapping
    const wordToNonce = parseWordToNonce(trial);
    
    // Validation
    if (targetIndex < 0 || targetIndex >= realWords.length) {
        console.error(`Invalid target_pos ${targetPos} for trial ${originalTrialNumber}`);
    }
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function() {
            currentTrial = trial;
            revealedWords.clear();
            startTime = Date.now();
            clickTimes = [];
            
            let html = `
                <div class="trial-counter">Trial ${trialNumber} of ${trialData.length}</div>
                <div class="instructions">
                    <p>Click on words to reveal their true meaning. The <strong>bolded word</strong> cannot be revealed - try to guess what it is based on the other words you reveal.</p>
                    <p>When you're ready to guess the bolded word, click "Make Guess".</p>
                </div>
                <div class="sentence-container" id="sentence-container">
            `;
            
            jabberWords.forEach((word, index) => {
                let wordClass = 'word';
                let wordText = word;
                
                if (index === targetIndex) {
                    wordClass += ' target';
                    // Keep the jabberwocky version for target - don't reveal it!
                    wordText = jabberWords[index];
                } else if (articles.includes(word.toLowerCase().replace(/[.,!?]/g, ''))) {
                    wordClass += ' article';
                    wordText = realWords[index];
                } else {
                    wordClass += ' clickable';
                }
                
                html += `<span class="${wordClass}" data-index="${index}">${wordText}</span>`;
            });
            
            html += `
                </div>
                <div class="controls">
                    <button class="guess-button" id="guess-btn">Make Guess</button>
                </div>
            `;
            
            return html;
        },
        choices: ['Make Guess'],
        button_html: '<button class="jspsych-btn" style="display: none;">%choice%</button>',
        on_load: function() {
            const words = document.querySelectorAll('.word.clickable');
            words.forEach(word => {
                word.addEventListener('click', function() {
                    const index = parseInt(this.dataset.index);
                    if (!revealedWords.has(index)) {
                        revealedWords.add(index);
                        clickTimes.push({
                            word_index: index,
                            revealed_word: realWords[index],
                            time_from_start: Date.now() - startTime
                        });
                        
                        this.textContent = realWords[index];
                        this.classList.remove('clickable');
                        this.classList.add('revealed');
                    }
                });
            });
            
            document.getElementById('guess-btn').addEventListener('click', function() {
                jsPsych.finishTrial({
                    trial_type: 'word-reveal',
                    trial_number: trialNumber,
                    original_trial_number: originalTrialNumber,
                    randomization_position: trialIndex + 1,
                    sublist: sublistNumber,
                    random_seed: randomSeed,
                    target_word_index: targetIndex,
                    target_word: trial.target_word,
                    entropy: trial.entropy,
                    target_probability: trial.target_probability,
                    revealed_words: Array.from(revealedWords),
                    click_times: clickTimes,
                    total_time_before_guess: Date.now() - startTime,
                    num_words_revealed: revealedWords.size,
                    jabber_sentence: jabberSentence,
                    real_sentence: realSentence
                });
            });
        },
        trial_duration: null,
        response_ends_trial: false
    };
}

// Function to create guess input trial
function createGuessInputTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const trialNumber = trialIndex + 1;
    const originalTrialNumber = trial.trial_number || trialNumber;
    
    return {
        type: jsPsychSurveyText,
        questions: [
            {
                prompt: `<div class="instructions">
                    <p>What do you think the <strong>bolded word</strong> was in the sentence?</p>
                    <p>Type your guess below:</p>
                </div>`,
                name: 'target_word_guess',
                required: true,
                rows: 1,
                columns: 40
            }
        ],
        on_finish: function(data) {
            data.trial_type = 'guess-input';
            data.trial_number = trialNumber;
            data.original_trial_number = originalTrialNumber;
            data.randomization_position = trialIndex + 1;
            data.sublist = sublistNumber;
            data.random_seed = randomSeed;
            data.correct_target_word = trial.target_word;
            data.target_word_index = trial.target_pos || trial.target_word_index;
            data.entropy = trial.entropy;
            data.target_probability = trial.target_probability;
            data.jabber_sentence = trial.jabber_passage || trial.nonsense_sentence;
            data.real_sentence = trial.passage_variant || trial.ground_truth_sentence;
            
            const guess = data.response.target_word_guess.toLowerCase().trim().replace(/[.,!?]/g, '');
            const correct = trial.target_word.toLowerCase().trim().replace(/[.,!?]/g, '');
            data.guess_correct = guess === correct;
            
            data.guess_length = data.response.target_word_guess.length;
            data.target_word_length = trial.target_word.length;
        }
    };
}

// Welcome screen
const welcome = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h1>Word Reveal Experiment</h1>
            <p>In this experiment, you will see sentences with made-up nonsense words.</p>
            <p>Your task is to:</p>
            <ul>
                <li>Click on words to reveal their true meaning</li>
                <li>Try to figure out what the <strong>bolded word</strong> means</li>
                <li>Make your best guess when you're ready</li>
            </ul>
            <p>Note: The bolded word cannot be revealed - you must guess it based on context.</p>
            <p><em>Press any key to continue</em></p>
        </div>
    `
};

// Instructions
const instructions = {
    type: jsPsychHtmlKeyboardResponse,
    stimulus: `
        <div style="max-width: 600px; margin: 0 auto; text-align: left;">
            <h2>Instructions</h2>
            <p>On each trial:</p>
            <ol>
                <li>You'll see a sentence with nonsense words</li>
                <li>One word will be <strong>bolded</strong> - this is your target word to guess</li>
                <li>Click on other words to reveal their true meaning</li>
                <li>When you think you know the bolded word, click "Make Guess"</li>
                <li>Type your guess for the bolded word</li>
            </ol>
            <p><em>Press any key to start</em></p>
        </div>
    `
};

// Create timeline
async function createTimeline() {
    await loadTrialData();
    
    let timeline = [welcome, instructions];
    
    // Add trials for each sentence (now in randomized order)
    for (let i = 0; i < trialData.length; i++) {
        timeline.push(createWordRevealTrial(i));
        timeline.push(createGuessInputTrial(i));
    }
    
    // Add data saving trial using jsPsychPipe
    const save_data = {
        type: jsPsychPipe,
        action: "save",
        experiment_id: "6sUXv8MJL3e6",
        filename: filename,
        data_string: () => jsPsych.data.get().csv()
    };
    
    timeline.push(save_data);
    
    // Thank you message
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: `
            <div style="text-align: center;">
                <h2>Thank you!</h2>
                <p>You have completed the experiment.</p>
                <p>Your data has been saved.</p>
                <p>Press any key to finish.</p>
            </div>
        `,
        on_finish: function() {
            jsPsych.data.addProperties({
                experiment_version: '1.0',
                sublist: sublistNumber,
                random_seed: randomSeed,
                completion_time: new Date().toISOString()
            });
        }
    });
    
    return timeline;
}

// Run the experiment
createTimeline().then(timeline => {
    jsPsych.run(timeline);
}).catch(error => {
    console.error('Error loading experiment:', error);
    document.body.innerHTML = `
        <div style="text-align: center; padding: 50px;">
            <h2>Error Loading Experiment</h2>
            <p>Could not load trial list for sublist ${sublistNumber}.</p>
            <p>Please make sure the file ${csvFilename} exists.</p>
            <p>Error: ${error.message}</p>
        </div>
    `;
});