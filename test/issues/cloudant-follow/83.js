// Copyright © 2018 IBM Corp. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
'use strict';

var request = require('request');
var tap = require('tap');
var test = tap.test;

var couch = require('../../couch');
var follow = require('../../../api');

test('Issue #83', function(t) {
  var saw_created = false;
  var saw_deleted = false;

  var feed = follow({ db: couch.DB_UPDATES, since: 'now' }, function(err, change) {
    t.error(err, 'No error on change.');

    var dbNameOffset = couch.DB.length - change.db_name.length;
    if (dbNameOffset !== couch.DB.lastIndexOf(change.db_name)) {
      return;
    }

    switch (change.type) {
      case 'created':
        t.notOk(saw_created, 'Only saw one created event.');
        saw_created = true;
        break;
      case 'deleted':
        t.notOk(saw_deleted, 'Only saw one deleted event.');
        saw_deleted = true;
        break;
      default:
        t.fail('Unexpected change type.');
    }
    if (saw_created && saw_deleted) {
      feed.stop();
      t.end();
    }
  });

  // Create updates by creating and deleting a database.

  setTimeout(function() {
    request.put({ uri: couch.DB, json: true }, function(err, res) {
      t.error(err, 'Create database without error');
      t.equal(res.statusCode, 201, 'Create database request returns 201.');
      request.delete({ uri: couch.DB, json: true }, function(err, res) {
        t.error(err, 'Delete database without error.');
        t.equal(res.statusCode, 200, 'Delete database request returns 200.');
      });
    });
  }, 5000);
});
