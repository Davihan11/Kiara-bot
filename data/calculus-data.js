const latex = require('../src/utils/latex')
const fs = require('fs');
const path = require('path');
const { calculusQuestions } = require('./calculusQuestions');

const QUESTIONS_FILE_PATH = path.join(__dirname, 'calculusQuestions.js');

async function getCalculusQuestion(memory, saveMemory){
    if (calculusQuestions.length === 0) {
        console.warn('Calculus skipped: no questions loaded.');
        return null;
    }
    const index = getIndex(memory, saveMemory);
    const data = calculusQuestions[index];

    //render the question first, then each step in order: q -> 1 -> 2 ... -> 9
    const expressions = [data.expression_q];
    for (let i = 1; i <= 9; i++) {
        if (data[`expression_${i}`]) expressions.push(data[`expression_${i}`]);
    }

    const files = [];
    for (let i = 0; i < expressions.length; i++) {
        const expr = expressions[i];
        const png = await latex.run_notEmbed(expr.latex, 0.8, expr.scale ?? 5);
        files.push({
            attachment: png,
            name: `${expr.spoiler ? 'SPOILER_' : ''}calculus_${i === 0 ? 'q' : i}.png`
        });
    }

    return { files, information: data.information, number: index + 1 };
}

//checks a submitted answer by comparing normalized strings against each accepted answer
function checkAnswer(submitted, answerArray){
    const normalize = s => s.replace(/\s+/g, ''); //strip all whitespace
    const submittedNorm = normalize(submitted);
    return answerArray.some(correct => normalize(correct) === submittedNorm);
}

//records an attempt into the question's attempts array and persists it to calculusQuestions.js
function recordAttempt(memory, saveMemory, questionNumber, userId, answerString, isCorrect){
    const question = calculusQuestions[questionNumber - 1];
    if (!question) return null;
    if (!Array.isArray(question.attempts)) question.attempts = [];

    let record = question.attempts.find(a => a.userId === userId);
    if (!record) {
        record = { userId, attemptCount: [], correct: null };
        question.attempts.push(record);
    }

    record.attemptCount.push(answerString);
    if (isCorrect && record.correct === null) record.correct = record.attemptCount.length;
    saveQuestions();
    return record;
}

//rewrites calculusQuestions.js with the current in-memory state (including attempts)
function saveQuestions(){
    const content = 'const calculusQuestions = ' + JSON.stringify(calculusQuestions, null, 4) + '\n\nmodule.exports = { calculusQuestions };\n';
    fs.writeFileSync(QUESTIONS_FILE_PATH, content, 'utf8');
}

function getIndex(memory, saveMemory){
    if (!memory.calculus) memory.calculus = { channelId: null, index: 0 }; //migrate old memory files
    if (typeof memory.calculus.index !== 'number') memory.calculus.index = 0;
    const index = memory.calculus.index;
    memory.calculus.index = (index + 1) % calculusQuestions.length; //wrap around at the end
    saveMemory(memory);
    const remaining = calculusQuestions.length - (index + 1);
    if (remaining > 5) console.log("Amount of questions remaining: " + remaining);
    else console.warn("WARNING! The number of calculus questions remaining is: " + remaining);
    return index;
}

module.exports = { getCalculusQuestion, checkAnswer, recordAttempt, calculusQuestions };