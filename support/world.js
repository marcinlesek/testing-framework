Function.prototype.curry = function() {
    var func = this;
    var slice = Array.prototype.slice;
    var appliedArgs = slice.call(arguments, 0);

    return function() {
        var leftoverArgs = slice.call(arguments, 0);
        return func.apply(this, appliedArgs.concat(leftoverArgs));
    };
};

global.tf = global.tf || {};

//imports
var path = require('path');
global.tf.projectDir = path.join(__dirname, '..');
var webdriver = require('selenium-webdriver'),
    By = webdriver.By;
var webdriverRemote = require('selenium-webdriver/remote');
var sprintf = require('sprintf-js').sprintf;
var config = require('./config.js');
var pageUrlData = require(global.tf.projectDir + '/data/pageUrlData.js');
var fs = require('fs');
var until = webdriver.until;

//vars
var driver;
var logsDirName;
var seleniumServerUrl = 'http://%s:%s/wd/hub';

const PLATFORM  = {
    CHROME: 'CHROME',
    FIREFOX: 'FIREFOX',
    IE: 'IE',
    EDGE: 'EDGE',
    OPERA: 'OPERA',
    SAFARI: 'SAFARI',
    PHANTOMJS: 'PHANTOMJS',
    HTMLUNITWITHJS: 'HTMLUNITWITHJS',
    ANDROID: 'ANDROID',
    IPHONE: 'IPHONE',
    IPAD: 'IPAD'
};

init();

//methods
function logMessage(logMessage, detailedOnlyLog) {
    var displayDetailedLog = config.detailedLog !== undefined ? config.detailedLog : false;

    if(displayDetailedLog && config.detailedTestLog) {
        console.log(sprintf('LOG-info: %s', logMessage));
    } else if(!displayDetailedLog) {
        console.log(sprintf('LOG: %s', logMessage));
    }
};

function logError(errorMessage, noThrow) {
    var message = sprintf('ERROR: %s', errorMessage);

    if(noThrow !== undefined && noThrow) {
        throw(message);
    }else {
        console.log(message);
    }
};

function loadPage(page) {
    return driver.get(page);
};

function loadPageByRoute(routeName, customTimeout) {
    var routeValue = pageUrlData['basic'][routeName];

    if(routeValue.charAt(0) === '/') {
        routeValue = routeValue.substr(1);
    }

    return driver.get(config.baseUrl + routeValue);
};

function validateUrl(url, customTimeout) {
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(function() {
            return driver.getCurrentUrl().then(function(currentUrl) {
                if(currentUrl.indexOf(url) !== -1) {
                    return true;
                } else {
                    return sleep(config.pollingRate).then(function() {
                        return false;
                    });
                }
            });
        },
        waitTimeout
    );
};

function validateUrlByRegex(regex, customTimeout) {
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(function() {
            return driver.getCurrentUrl().then(function(currentUrl) {
                var r = new RegExp(regex);
                if(r.test(currentUrl)) {
                    return true;
                }

                return sleep(config.pollingRate).then(function() {
                    return false;
                });
            });
        },
        waitTimeout
    );
};

function getCurrentUrl() {
    return driver.getCurrentUrl();
};

function validateUrlByRoute(pageName, customTimeout) {
    if(pageUrlData['regex'] !== undefined && pageUrlData['regex'][pageName] !== undefined) {
        var url = pageUrlData['regex'][pageName];

        return validateRegexUrl(regex, customTimeout);
    } else if(pageUrlData['basic'] !== undefined && pageUrlData['basic'][pageName] !== undefined) {
        var url = pageUrlData['basic'][pageName];

        return validateUrl(url, customTimeout);
    } else {
        logError('validateUrlByRoute - incorrect page name: ' + pageName);
    }
};

 function getDocumentReadyState() {//internal only
    return driver.executeScript(
        'return document.readyState === \'complete\'',
        ''
    ).then(function(result) {
        return result;
    });
};

function checkAngularPresence() {
    var script = 'return (window.angular !== undefined)';

    return driver.executeScript(script, '').then(function(result) {
        return result;
    });
};

function checkExtendedPageState() {
    if(config.extendedPageReadyStateValidation) {
        return checkAngularPresence().then(function(present) {
            if(present) {
                //angular-based page - validation
                var script = 'return (angular.element(document.body).injector() !== undefined) && ' +
                '(angular.element(document.body).injector().get(\'$http\').pendingRequests.length === 0)';

                return driver.executeScript(script, '').then(function(result) {
                    return result;
                });
            }

            return true;//currently only Angular
        });
    } else {
        return boolPromiseResult(true);
    }
};

function validateExtendedPageState(customTimeout) {
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(function() {
        return checkExtendedPageState()
            .then(function(value) {
                if(value) {
                    return true;
                }

                return sleep(config.pollingRate).then(function() {
                    return false;
                });
            });
        },
        waitTimeout
    );
};

function validatePageReadyState(customTimeout) {
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(function() {
        return getDocumentReadyState()
            .then(function(value) {
                if(value) {
                    return true;
                }

                return sleep(config.pollingRate).then(function() {
                    return false;
                });
            })
        },
        waitTimeout
    ).then(function() {
        return validateExtendedPageState(waitTimeout);
    });
};

function waitForElement(xpath, customTimeout) {//internal only
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(
        function () {
            return driver.findElements(By.xpath(xpath)).then(function(el) {
                if(el.length > 0) {
                    return true;
                } else {
                    return sleep(config.pollingRate).then(function() {
                        return false;
                    });
                }
            });
        },
        waitTimeout
    ).catch(function(err){
        throw(`waitForElement failed on element: "${ xpath }" - error message: "${ err.message }", error stack: "${ err.stack }`);
    });
};

function findElement(xpath, customTimeout) {
    return waitForElement(xpath, customTimeout)
        .then(function() {
            return driver.findElement(By.xpath(xpath));
        });
};

function findElements(xpath, customTimeout) {
    return waitForElement(xpath, customTimeout)
        .then(function() {
            return driver.findElements(By.xpath(xpath));
        });
};

function getElementsNumber(xpath, customTimeout) {
    return driver.findElements(By.xpath(xpath))
        .then(function(el) {
            return el.length;
        });
};

function validateElementsNumber(xpath, number, customTimeout) {

    var waitTimeout = customTimeout || config.defaultTimeout;

    if(number === 0) {
        return validatePageReadyState().then(function() {
            return isElementNotVisible(xpath, waitTimeout);
        });
    } else {
        return driver.wait(
            function () {
                return findElements(xpath, waitTimeout).then(function(elem) {
                    if(elem.length === number) {
                        return true;
                    } else {
                        return sleep(config.pollingRate).then(function() {
                            return false;
                        });
                    }
                });
            },
            waitTimeout
        ).catch(function(err){
            throw(`validateElementsNumber failed on element: "${ xpath }" - error message: "${ err.message }", error stack: "${ err.stack }`);
        });
    }
};

function validateElementDisplayed(xpath, customTimeout) {//visible in sources AND displayed
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(
        function () {
            return findElements(xpath, waitTimeout).then(function(elem) {
                if(elem[0].isDisplayed()) {
                    return true;
                } else {
                    return sleep(config.pollingRate).then(function() {
                        return false;
                    });
                }
            });
        },
        waitTimeout
    ).catch(function(err){
        throw(`validateElementDisplayed failed on element: "${ xpath }" - error message: "${ err.message }", error stack: "${ err.stack }`);
    });
};

function validateElementNotDisplayed(xpath, customTimeout) {//element visible in sources and not displayed
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(
        function () {
            return findElements(xpath, waitTimeout).then(function(elem) {
                if(!elem[0].isDisplayed()) {
                    return true;
                } else {
                    return sleep(config.pollingRate).then(function() {
                        return false;
                    });
                }
            });
        },
        waitTimeout
    ).catch(function(err){
        throw(`validateElementNotDisplayed failed on element: "${ xpath }" - error message: "${ err.message }", error stack: "${ err.stack }`);
    });
};

function validateElementVisible(xpath, customTimeout) {//element visible in sources and may be displayed or not
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(
        function () {
            return findElements(xpath).then(function(elem) {
                if(elem.length !== 0) {
                    return true;
                } else {
                    return sleep(config.pollingRate).then(function() {
                        return false;
                    });
                }
            });
        },
        waitTimeout
    ).catch(function(err){
        throw(`validateElementVisible failed on element: "${ xpath }" - error message: "${ err.message }", error stack: "${ err.stack }`);
    });
};

function validateElementNotVisible(xpath, customTimeout) {//not visible in sources and not displayed
    var waitTimeout = customTimeout || config.defaultTimeout;

    return validatePageReadyState().then(function() {
        return driver.wait(
            function () {
                return driver.findElements(By.xpath(xpath)).then(function(elem) {
                    if(elem.length === 0) {
                        return true;
                    } else {
                        return sleep(config.pollingRate).then(function() {
                            return false;
                        });
                    }
                });
            },
            waitTimeout
        ).catch(function(err){
                throw(`validateElementNotVisible failed on element: "${ xpath }" - error message: "${ err.message }", error stack: "${ err.stack }`);
        });
    });
};

function jsBasedClick(xpath) {
    //TODO2: timeout
    return findElement(xpath, 0)
        .then(function() {
            return driver.executeScript(
                `document.evaluate(\'${ xpath }\', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue.click();`
            ).then(function() {
                return true;
            });
        });
};

function click(xpath, customTimeout) {
    return validatePageReadyState()
        .then(function() {
            return findElement(xpath, customTimeout)
                .then(function(el) {
                    el.click().catch(function(err) {
                        logMessage(`Standard click failed with error message: "${ err.message }"`, true);
                        return jsBasedClick(xpath);
                    });
                });
        });
};

function hover(xpath, customTimeout) {
    return validatePageReadyState()
        .then(function() {
            return findElement(xpath, customTimeout).then(function(el) {
                return driver.actions().mouseMove(el).perform();
            });
        });
};

function fillInInput(xpath, value, blur, customTimeout) {
    var element;

    return findElement(xpath, customTimeout)
        .then(function(el) {
            element = el;

            return element.clear();
        })
        .then(function() {
            element.sendKeys(typeof blur !== 'undefined' && blur ? value  + '\t': value);
        });
};

function getCheckboxValue(xpath, customTimeout) {
    return findElement(xpath, customTimeout)
        .then(function(el) {
            return el.isSelected();
        });
};

function validateCheckboxValue(xpath, value, customTimeout) {
    var waitTimeout = customTimeout || config.defaultTimeout;

    return driver.wait(
        function () {
            return getCheckboxValue(xpath, customTimeout).then(function(elemState) {
                return elemState === value;
            });
        },
        waitTimeout
    ).catch(function(err){
        throw(`validateCheckboxValue failed on element: "${ xpath }" - error message: "${ err.message }", error stack: "${ err.stack }`);
    });
};

function setCheckboxValue(xpath, value, customTimeout) {
    var waitTimeout = customTimeout || config.defaultTimeout;

    return getCheckboxValue(xpath, waitTimeout).then(function(isChecked) {
        if(isChecked === value) {
            return true;
        }

        return click(xpath, waitTimeout).then(function() {
            return true;
        });
    });
};

function selectFileInputValue(inputXP, fileName, customTimeout) {
    var waitTimeout = customTimeout || config.defaultTimeout;

    return findElement(inputXP, waitTimeout)
        .then(function(el) {
            var filePath = global.tf.projectDir + '/data/test_files/' + fileName;
            logMessage(`Selecting ${ filePath } file.`);

            return el.sendKeys(filePath);
      });
};

function sleep(sleepTime) {
    return new Promise((resolve) => setTimeout(resolve, sleepTime));
};

function getDriver() {
    return driver;
};

function getLogsDirName() {//internal only
    return logsDirName;
};

function cleanBrowserState() {
    return driver.executeScript('return window.location.hostname.length > 0', '').then(function(result) {//data URLs
        if(result) {
            driver.executeScript('localStorage.clear()');
            driver.executeScript('sessionStorage.clear()');
            driver.executeScript('console.clear()');
        } else {
            logError('Can\'t clean localStorage and sessionStorage');
        }

        return driver.manage().deleteAllCookies();
    });
};

function takeScreenshot(fileName, directory) {
    var screenshotFilePath = path.join(directory, fileName + ".png");

    return driver.takeScreenshot().then(function(data){
        var base64Data = data.replace(/^data:image\/png;base64,/,"");

        return fs.writeFile(screenshotFilePath, base64Data, 'base64', function(err) {
            if(err) {
                logError('takeScreenshot eror: ' + err);
            }
        });
    });
};

//angular-specific methods

function getAngularInputValue(xpath, customTimeout) {
    //TODO2: implement
};

function validateAngularInputValue(xpath, expectedValue, customTimeout) {
    //TODO2: implement
};

//internal methods

function boolPromiseResult(value) {
    return new Promise(function(resolve, reject){
        resolve(value);
    });
};

function init() {

    logsDirName = getCurrentDate();

    driver = buildDriver(config.platform);
    loadDriverOptions(driver);
};

function getCurrentDate() {
    var date = new Date();
    var str = `${ date.toJSON().slice(0,10) }_${ date.getHours() }-${ date.getMinutes() }-${ date.getSeconds() }-${ date.getMilliseconds() }`;

    return str;
};

function buildDriver(platform) {
    var capabilities;

    switch(platform) {
        case PLATFORM.CHROME:
            capabilities = webdriver.Capabilities.chrome();
            break;
        case PLATFORM.FIREFOX:
            capabilities = webdriver.Capabilities.firefox();
            break;
        case PLATFORM.IE:
            capabilities = webdriver.Capabilities.ie();
            break;
        case PLATFORM.EDGE:
            capabilities = webdriver.Capabilities.edge();
            break;
        case PLATFORM.OPERA:
            capabilities = webdriver.Capabilities.opera();
            break;
        case PLATFORM.SAFARI:
            capabilities = webdriver.Capabilities.safari();
            break;
        case PLATFORM.PHANTOMJS:
            capabilities = webdriver.Capabilities.phantomjs();
            break;
        case PLATFORM.HTMLUNITWITHJS:
            capabilities = webdriver.Capabilities.htmlunitwithjs();
            break;
        case PLATFORM.ANDROID:
            capabilities = webdriver.Capabilities.android();
            break;
        case PLATFORM.IPHONE:
            capabilities = webdriver.Capabilities.iphone();
            break;
        case PLATFORM.IPAD:
            capabilities = webdriver.Capabilities.ipad();
            break;
    }

    var logPreferences = new webdriver.logging.Preferences();
    logPreferences.setLevel('driver', config.seleniumDriverLogLevel);
    logPreferences.setLevel('browser', config.seleniumBrowserLogLevel);

    var seleniumProxy = require('selenium-webdriver/proxy');
    var proxyUrl = config.proxyHost + ':' + config.proxyHttpPort;

    return new webdriver.Builder()
        .usingServer(sprintf(seleniumServerUrl, config.seleniumServerHost, config.seleniumServerPort))
        .withCapabilities(capabilities)
        .setLoggingPrefs(logPreferences)
        .setProxy(seleniumProxy.manual({
            http: proxyUrl
        }))
        .build();
};

function loadDriverOptions(driver) {
    if(config.runMaximized) {
        driver.manage().window().maximize();
    }

    if(config.xvfbMode) {
        driver.manage().window().setSize(config.xvfbSettings.windowWidth, config.xvfbSettings.windowHeight);
    }

    driver.setFileDetector(new webdriverRemote.FileDetector);
};

module.exports = {
    logMessage: logMessage,
    logError: logError,
    loadPage: loadPage,
    loadPageByRoute: loadPageByRoute,
    findElement: findElement,
    findElements: findElements,
    validateElementDisplayed: validateElementDisplayed,
    validateElementNotDisplayed: validateElementNotDisplayed,
    validateElementVisible: validateElementVisible,
    validateElementNotVisible: validateElementNotVisible,
    validateElementsNumber: validateElementsNumber,
    click: click,
    getCheckboxValue: getCheckboxValue,
    setCheckboxValue: setCheckboxValue,
    validateCheckboxValue: validateCheckboxValue,
    getCurrentUrl: getCurrentUrl,
    hover: hover,
    fillInInput: fillInInput,
    selectFileInputValue: selectFileInputValue,
    getDriver: getDriver,
    getElementsNumber: getElementsNumber,
    getCurrentDate: getCurrentDate,
    sleep: sleep,
    getLogsDirName: getLogsDirName,
    cleanBrowserState: cleanBrowserState,
    takeScreenshot: takeScreenshot,
    validatePageReadyState: validatePageReadyState,
    validateUrl: validateUrl,
    validateUrlByRegex: validateUrlByRegex,
    validateUrlByRoute: validateUrlByRoute
};
