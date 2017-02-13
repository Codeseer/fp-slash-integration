var phantomjs = require('phantomjs-prebuilt')
var webdriverio = require('webdriverio')
var request = require('request')
var wdOpts = { desiredCapabilities: { browserName: 'phantomjs' } }
var express = require('express')
var bodyParser = require('body-parser');
var storage = require('node-persist');
var app = express()
app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true }));  // for parsing application/x-www-form-urlencoded

const INC_FIELDS = ['Title', 'Description', 'Due Date', 'Assigned To']

storage.init().then(function() {
  phantomjs.run('--webdriver=4444').then(program => {
    var getDescription = function (creds, taskId) {
      if(!creds) {
        return Promise.reject("No credentials setup. \nRun /fp login organization :: username :: password")
      }
      var browser = webdriverio.remote(wdOpts).init();
      return browser.url('https://helium.functionpoint.com/fpX/html/Default/Login/show-Login')
      .then(() => browser.setValue('#fp_login_client', creds.organization))
      .then(() => browser.setValue('#fp_login_username', creds.username))
      .then(() => browser.setValue('#fp_login_password', creds.password))
      .then(() => browser.submitForm('#fp_login_form'))
      .then(() => browser.waitForExist('#fp_console_wrapper', 10000))
      .then(() => browser.url('https://helium.functionpoint.com/fpX/html/Task/Task/details/taskID/'+taskId))
      .then(() => browser.waitForExist('.fp_form_field .fp_form_label', 5000))
      .then(() => browser.getText('.fp_form_field .fp_form_label'))
      .then((labels) => {
        return browser.getText('.fp_form_field .fp_form_value_wrapper').then((values) => {
          var fields = {};
          for(i in labels) {
            fields[labels[i]] = values[i];
          }
          return fields
        })
      })
    }
    var setup = function (req, res) {
      var paramsString = req.body.text;
      //should be in format "login <organization> ::: <username> ::: <password>"
      paramsString = paramsString.replace("login","")
      var creds = paramsString.split("::")
      if (creds.length != 3) {
        res.status(403).send('Function Point login credentials could not be parssed. \nUse format /fp login organization :: username :: password')
        return;
      }
      //save the credentials
      var credsObj = {
        "organization": creds[0].trim(),
        "username": creds[1].trim(),
        "password": creds[2].trim()
      }
      var key = req.body.team_id+req.body.user_id;
      storage.setItem(key, credsObj)
      .then(() => res.status(200).send("login credentials successfully saved."))
    }
    //returns saved credentials based on slack params
    var getCreds = function (body) {
      var key = body.team_id+body.user_id;
      return storage.getItem(key)
    }

    app.post('/', function (req, res) {
      var taskId = req.body.text.trim();
      if(taskId.startsWith("login")) {
        setup(req, res);
        return;
      }
      if(isNaN(taskId)) {
        res.status(403).send('Invalid taskId')
        return;
      }
      res.status(200).send('Fetching Function Point task information...')
      getCreds(req.body)
      .then((creds) => getDescription(creds, taskId))
      .then((fields) => {
        var responseText = '';
        for( label in fields) {
          if(INC_FIELDS.indexOf(label) != -1) {
            if(label == 'Title') {
              responseText += '*<https://helium.functionpoint.com/fpX/html/Task/Task/details/taskID/' + taskId + '|' + fields[label] + '>*\n';
            } else if(label == 'Description'){
              responseText += '*' + label + ':* \n' + fields[label] + '\n';
            } else {
              responseText += '*' + label + ':* ' + fields[label] + '\n';
            }
          }
        }
        var responseJSON = {
          'response_type': 'in_channel',
          'text': responseText
        }
        //send the response since sometimes it takes more than 3000ms to get the info.
        console.log(responseJSON);
        request.post(
            req.body.response_url,
            { json: responseJSON },
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    console.log(body)
                    program.kill();
                }
            }
        );
      })
      .catch(error => {
        console.error(error)
        var responseErrorJSON = {
          'response_type': 'ephemeral',
          'text': "Error with your login credentials. Please set them via /fp login"
        }
        request.post(
            req.body.response_url,
            { json: responseErrorJSON },
            function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    console.log(responseErrorJSON)
                }
            }
        );
      })
    })
    app.listen(80, function () {
      console.log('Example app listening on port 80!')
    })
  })
})
