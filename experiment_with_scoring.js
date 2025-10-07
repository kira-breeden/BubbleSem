// Global variables
let trialData = [];
let currentTrialIndex = 0;
let currentTrial = null;
let revealedWords = new Set();
let startTime = null;
let clickTimes = [];
let totalPoints = 100; // Starting points
const POINTS_PER_REVEAL = 3; // Points lost per word reveal

// Articles that should not be obscured
const articles = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];

// Initialize jsPsych
const jsPsych = initJsPsych({});

// Initialize filename based on workerId
const subject_id = jsPsych.randomization.randomID(10);
const filename = `${subject_id}.csv`;

// Function to load CSV data
function loadTrialData() {
    return new Promise((resolve, reject) => {
        Papa.parse('trial_list_test.csv', {
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
                
                const requiredColumns = ['ground_truth_sentence', 'nonsense_sentence', 'target_word_index', 'target_word'];
                const firstRow = results.data[0];
                const missingColumns = requiredColumns.filter(col => !(col in firstRow));
                
                if (missingColumns.length > 0) {
                    reject(new Error(`Missing required columns: ${missingColumns.join(', ')}`));
                    return;
                }
                
                trialData = results.data;
                console.log(`Successfully loaded ${trialData.length} trials`);
                resolve();
            },
            error: function(error) {
                console.error('Error loading CSV:', error);
                reject(error);
            }
        });
    });
}

// Function to update points display
function updatePointsDisplay(points) {
    const pointsElement = document.getElementById('points-counter');
    if (pointsElement) {
        pointsElement.textContent = `Points: ${points}`;
        // Add visual feedback for point loss
        pointsElement.style.color = '#d32f2f';
        setTimeout(() => {
            pointsElement.style.color = '#333';
        }, 300);
    }
}

// Function to create word reveal trial
function createWordRevealTrial(trialIndex) {
    const trial = trialData[trialIndex];
    const nonsenseWords = trial.nonsense_sentence.split(' ');
    const realWords = (trial.ground_truth_sentence || trial.real_sentence).split(' ');
    const targetIndex = parseInt(trial.target_word_index);
    const trialNumber = trial.trial_number || trial.sentence_id || (trialIndex + 1);
    
    // Track revealed words for this trial
    let trialRevealedWords = [];
    let trialRevealOrder = [];
    
    // Validation: Check that target_word_index makes sense
    if (targetIndex < 0 || targetIndex >= nonsenseWords.length) {
        console.error(`Invalid target_word_index ${targetIndex} for trial ${trialNumber}`);
    }
    
    // Validation: Check that the target word matches
    const expectedTargetWord = realWords[targetIndex];
    if (expectedTargetWord && expectedTargetWord.toLowerCase().replace(/[.,!?]/g, '') !== 
        trial.target_word.toLowerCase().replace(/[.,!?]/g, '')) {
        console.warn(`Target word mismatch in trial ${trialNumber}: expected "${expectedTargetWord}", got "${trial.target_word}"`);
    }
    
    return {
        type: jsPsychHtmlButtonResponse,
        stimulus: function() {
            currentTrial = trial;
            revealedWords.clear();
            startTime = Date.now();
            clickTimes = [];
            trialRevealedWords = [];
            trialRevealOrder = [];
            
            let html = `
                <div style="position: relative;">
                    <div class="trial-counter">Trial ${trialNumber} of ${trialData.length}</div>
                    <div class="points-counter" id="points-counter">Points: ${totalPoints}</div>
                    <div class="instructions">
                        <p>Click on words to reveal their true meaning. The <strong>bolded word</strong> cannot be revealed - try to guess what it is based on the other words you reveal.</p>
                        <p><strong>Warning:</strong> Each word you reveal costs ${POINTS_PER_REVEAL} points! Try to keep as many points as possible.</p>
                        <p>When you're ready to guess the bolded word, click "Make Guess".</p>
                    </div>
                    <div class="sentence-container" id="sentence-container">
            `;
            
            nonsenseWords.forEach((word, index) => {
                let wordClass = 'word';
                let wordText = word;
                
                if (index === targetIndex) {
                    wordClass += ' target';
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
                        
                        // Deduct points
                        totalPoints -= POINTS_PER_REVEAL;
                        updatePointsDisplay(totalPoints);
                        
                        // Track revealed word and order
                        const revealedWord = realWords[index];
                        trialRevealedWords.push(revealedWord);
                        trialRevealOrder.push(index);
                        
                        clickTimes.push({
                            word_index: index,
                            revealed_word: revealedWord,
                            time_from_start: Date.now() - startTime
                        });
                        
                        this.textContent = revealedWord;
                        this.classList.remove('clickable');
                        this.classList.add('revealed');
                    }
                });
            });
            
            document.getElementById('guess-btn').addEventListener('click', function() {
                jsPsych.finishTrial({
                    trial_type: 'word-reveal',
                    trial_number: trialNumber,
                    sentence_id: trial.sentence_id || trialNumber,
                    target_word_index: targetIndex,
                    target_word: trial.target_word,
                    revealed_words: trialRevealedWords,
                    revealed_word_indices: trialRevealOrder,
                    click_times: clickTimes,
                    total_time_before_guess: Date.now() - startTime,
                    num_words_revealed: revealedWords.size,
                    points_remaining: totalPoints,
                    points_lost_this_trial: revealedWords.size * POINTS_PER_REVEAL,
                    nonsense_sentence: trial.nonsense_sentence,
                    ground_truth_sentence: realWords.join(' ')
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
    const trialNumber = trial.trial_number || trial.sentence_id || (trialIndex + 1);
    
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
            data.sentence_id = trial.sentence_id || trialNumber;
            data.correct_target_word = trial.target_word;
            data.target_word_index = trial.target_word_index;
            data.nonsense_sentence = trial.nonsense_sentence;
            data.ground_truth_sentence = trial.ground_truth_sentence || trial.real_sentence;
            data.points_remaining = totalPoints;
            
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
            <p><strong>Scoring:</strong> You start with <strong>100 points</strong>. Each word you reveal costs <strong>${POINTS_PER_REVEAL} points</strong>. Try to keep as many points as possible!</p>
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
                <li>Click on other words to reveal their true meaning (<strong>${POINTS_PER_REVEAL} points each</strong>)</li>
                <li>When you think you know the bolded word, click "Make Guess"</li>
                <li>Type your guess for the bolded word</li>
            </ol>
            <p><strong>Remember:</strong> You start with 100 points. Your goal is to keep as many points as possible!</p>
            <p><em>Press any key to start</em></p>
        </div>
    `
};

// Create timeline
async function createTimeline() {
    await loadTrialData();
    
    let timeline = [welcome, instructions];
    
    // Add trials for each sentence
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
    
    // Thank you message with final score
    timeline.push({
        type: jsPsychHtmlKeyboardResponse,
        stimulus: function() {
            return `
                <div style="text-align: center;">
                    <h2>Thank you!</h2>
                    <p>You have completed the experiment.</p>
                    <p><strong>Final Score: ${totalPoints} points</strong></p>
                    <p>Your data has been saved.</p>
                    <p>Press any key to finish.</p>
                </div>
            `;
        },
        on_finish: function() {
            jsPsych.data.addProperties({
                experiment_version: '1.0',
                completion_time: new Date().toISOString(),
                final_score: totalPoints
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
    document.body.innerHTML = '<p>Error loading experiment. Please refresh the page.</p>';
});