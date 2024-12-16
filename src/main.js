const { execSync } = require('child_process');
const chalk = require('chalk');
const cheerio = require('cheerio');
const fs = require('fs');
const webhook = require('webhook-discord');
const moment = require('moment');
const path = require('path');
const request = require('request');


const config = require('./config.json');
const UserA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36";
const login_url = "https://admissions.42.fr/users/sign_in";
const cookieFilePath = path.join(__dirname, 'cookies.json');

async function main() {
    let task = {};
    task.url = login_url;
    task.jar = request.jar();
    task.request = request.defaults({ jar: task.jar });
    task.counter = 1;
    task.inscription1 = false;
    task.inscription2 = false;
    task.inscription3 = false;

    if (fs.existsSync(cookieFilePath)) {
        const cookiesData = JSON.parse(fs.readFileSync(cookieFilePath));
        cookiesData.forEach(cookieStr => {
            const cookie = request.cookie(cookieStr);
            task.jar.setCookie(cookie, login_url);
        });
        console.log(chalk.white(`[${moment().format("HH:mm:ss")}] - Cookies chargés depuis le fichier.`));
        
        const isValid = await checkCookiesValidity(task);
        if (isValid) {
            console.log(chalk.green(`[${moment().format("HH:mm:ss")}] - Cookies valides, pas besoin de se reconnecter.`));
            task.monitor_url = login_url;
            task.loop_monitor = true;
            while (task.loop_monitor) {
                task.success = false;
                await monitor(task, cookiesData);
            }
            return; 
        } else {
            console.log(chalk.yellow(`[${moment().format("HH:mm:ss")}] - Cookies expirés, nouvelle connexion nécessaire.`));
        }
    }

    console.log(chalk.white(`[${moment().format("HH:mm:ss")}] - Trying To Login...`));
    task.run = true;
    while (task.run) {
        let cookies = await login(task);
        console.log(chalk.blue(`[${moment().format("HH:mm:ss")}] - Successful Login! cookie: ${cookies}`));

        fs.writeFileSync(cookieFilePath, JSON.stringify(cookies));

        task.loop_monitor = true;
        while (task.loop_monitor) {
            task.success = false;
            await monitor(task, cookies);
            if (task.success) {
                console.log(chalk.green(`[${moment().format("HH:mm:ss")}] - Checkin Available!`));
                send_webhook();
                await sign_up(task);
            }
            await sleep(config.retry_delay);
        }
        await sleep(2000);
        console.log("Re-Login");
    }
}

async function checkCookiesValidity(task) {
    return new Promise((resolve) => {
        const options = {
            url: login_url,
            jar: task.jar,
            headers: {
                'User-Agent': UserA
            }
        };

        task.request(options, (error, response, body) => {
            if (!error && response.statusCode === 200 && !body.includes('Connexion')) {
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}

function login(task) {
    return new Promise((resolve, reject) => {
        const options = {
            url: task.url,
            method: 'POST',
            headers: {
                'User-Agent': UserA,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            form: {
                'user[email]': config.email,
                'user[password]': config.password,
                'commit': 'Log in'
            }
        };

        task.request(options, (error, response, body) => {
            if (error) {
                console.log(chalk.red("Error: " + error));
                task.run = false;
                reject(error);
            } else {
                const cookies = response.headers['set-cookie'];
                if (cookies) {
                    task.monitor_url = response.request.uri.href;
                    resolve(cookies);
                } else {
                    console.log(chalk.red(`[${moment().format("HH:mm:ss")}] - Error Getting Cookie, Retrying in ${config.retry_delay}ms...`));
                    resolve(null);
                }
            }
        });
    });
}

async function monitor(task, cookies) {
    return new Promise(async (resolve, reject) => {
        let loop = true;
        while (loop) {
            console.log(`[${moment().format("HH:mm:ss")}] - Monitoring...`);
            task.counter++;
            if (task.counter == 1000) {
                console.clear();
                task.counter = 1;
            }

            const options = {
                url: task.monitor_url,
                headers: {
                    'User-Agent': UserA,
                    'Cookie': cookies.join('; ')
                }
            };

            task.request(options, (error, response, body) => {
                if (error) {
                    console.log(chalk.red("Error: " + error));
                    task.run = false;
                    reject(error);
                } else {
                    const $ = cheerio.load(body);
                    if ($('title').text() == "42 Paris | Connexion") {
                        console.log(`[${moment().format("HH:mm:ss")}] - Disconnected`);
                        task.loop_monitor = false;
                        resolve();
                    }
                    if (body.includes('Présentation')) {
                        let inscription = $('li.list-group-item');
                        let checkinAvailable = false;
                        inscription.each((index, element) => {
                            const inputValue = $(element).find('input[type="submit"]').val();
                            if (inputValue && inputValue !== "Enregistrement impossible") {
                                checkinAvailable = true;
                                console.log(chalk.green(`[${moment().format("HH:mm:ss")}] - Check-in ${index + 1} available!`));
                            }
                        });
                        if (checkinAvailable) {
                            task.success = true;
                            loop = false;
                            resolve();
                        }
                    }
                }
            });
            await sleep(config.retry_delay);
        }
    });
}

function sign_up(task) {
    return new Promise((resolve, reject) => {
        const options = {
            url: task.url,
            method: 'POST',
            headers: {
                'User-Agent': UserA,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            form: {
                'user[email]': config.email,
                'user[password]': config.password,
                'commit': 'Log in'
            }
        };

        task.request(options, (error, response, body) => {
            if (error) {
                console.log(chalk.red("Error: " + error));
                reject(error);
            } else {
                const $ = cheerio.load(body);
                if (body.includes("allow cookies")) {
                    task.request.post({ url: task.url, form: { 'allow_cookies': 'true' } });
                }
                if (task.inscription2) {
                    task.request.post({ url: task.url, form: { 'inscription2': 'true' } });
                }
                if (task.inscription3) {
                    task.request.post({ url: task.url, form: { 'inscription3': 'true' } });
                }
                console.log(chalk.green(`[${moment().format("HH:mm:ss")}] - Signed In!`));
                resolve();
            }
        });
    });
}

function send_webhook() {
    const Hook = new webhook.Webhook(config.discord_webhook);
    const message = new webhook.MessageBuilder()
        .setName("42 Check-in Monitor")
        .setURL('https://admissions.42.fr/')
        .setTitle("CHECK-IN AVAILABLE! GO GO GO")
        .setDescription("Foncez vous inscrire!")
        .setFooter("Shyybi", "https://avatars.githubusercontent.com/u/146101928?v=4")
        .setTime()
        .setText("<@&1287762819151958036>");
    Hook.send(message);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

main();
