// Copyright © 2017, 2018 IBM Corp. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License"); you may not
// use this file except in compliance with the License. You may obtain a copy of
// the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
// WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
// License for the specific language governing permissions and limitations under
// the License.

var tap = require('tap')
  , test = tap.test
  , util = require('util')
  , request = require('request')

var couch = require('./couch')
  , follow = require('../api')

var getSeq = couch.get_update_seq; // alias

couch.setup(test)

test('Follow API', function(t) {
  var i = 0
    , saw = {}

  var feed = follow(couch.DB, function(er, change) {
    t.is(this, feed, 'Callback "this" value is the feed object')

    i += 1
    t.false(er, 'No error coming back from follow: ' + i)
    t.equal(getSeq(change.seq), i, 'Change #'+i+' should have seq_id='+i)
    saw[change.id] = true

    if(i == 3) {
      t.ok(saw.doc_first, 'Got the first document')
      t.ok(saw.doc_second, 'Got the second document')
      t.ok(saw.doc_third , 'Got the third document')

      t.doesNotThrow(function() { feed.stop() }, 'No problem calling stop()')

      t.end()
    }
  })
})

test('Follow API when specifying endpoint', function(t) {
  var i = 0
    , saw = {}

  var feed = follow(couch.DB + '/_changes', function(er, change) {
    t.is(this, feed, 'Callback "this" value is the feed object')

    i += 1
    t.false(er, 'No error coming back from follow: ' + i)
    t.equal(getSeq(change.seq), i, 'Change #'+i+' should have seq_id='+i)
    saw[change.id] = true

    if(i == 3) {
      t.ok(saw.doc_first, 'Got the first document')
      t.ok(saw.doc_second, 'Got the second document')
      t.ok(saw.doc_third , 'Got the third document')

      t.doesNotThrow(function() { feed.stop() }, 'No problem calling stop()')

      t.end()
    }
  })
})

test("Confirmation request behavior", function(t) {
  var feed = follow(couch.DB, function() {})

  var confirm_req = null
    , follow_req = null

  feed.on('confirm_request', function(req) { confirm_req = req })
  feed.on('query', function(req) { follow_req = req })

  setTimeout(check_req, couch.rtt() * 2)
  function check_req() {
    t.ok(confirm_req, 'The confirm_request event should have fired by now')
    t.ok(confirm_req.agent, 'The confirm request has an agent')

    t.ok(follow_req, 'The follow_request event should have fired by now')
    t.ok(follow_req.agent, 'The follow request has an agent')

    // Confirm that the changes follower is not still in the pool.
    var host = 'localhost:5984'
    var sockets = follow_req.req.agent.sockets[host] || []
    sockets.forEach(function(socket, i) {
      t.isNot(socket, follow_req.req.connection, 'The changes follower is not socket '+i+' in the agent pool')
    })

    feed.stop()
    t.end()
  }
})

test('Heartbeats', function(t) {
  t.ok(couch.rtt(), 'The couch RTT is known')
  var check_time = couch.rtt() * 3.5 // Enough time for 3 heartbeats.

  var beats = 0
    , retries = 0

  var feed = follow(couch.DB, function() {})
  feed.heartbeat = couch.rtt()
  feed.on('response', function() { feed.retry_delay = 1 })

  feed.on('heartbeat', function() { beats += 1 })
  feed.on('retry', function() { retries += 1 })

  feed.on('catchup', function() {
    t.equal(beats, 0, 'Still 0 heartbeats after receiving changes')
    t.equal(retries, 0, 'Still 0 retries after receiving changes')

    //console.error('Waiting ' + couch.rtt() + ' * 3 = ' + check_time + ' to check stuff')
    setTimeout(check_counters, check_time)
    function check_counters() {
      t.equal(beats, 3, 'Three heartbeats ('+couch.rtt()+') fired after '+check_time+' ms')
      t.equal(retries, 0, 'No retries after '+check_time+' ms')

      feed.stop()
      t.end()
    }
  })
})

test('Catchup events', function(t) {
  t.ok(couch.rtt(), 'The couch RTT is known')

  var feed = follow(couch.DB, function() {})
  var last_seen = 0

  feed.on('change', function(change) { last_seen = change.seq })
  feed.on('catchup', function(id) {
    t.equal(getSeq(last_seen), 3, 'The catchup event fires after the change event that triggered it')
    t.equal(getSeq(id)       , 3, 'The catchup event fires on the seq_id of the latest change')
    feed.stop()
    t.end()
  })
})

test('Specify a custom HTTP agent', function(t) {
  var feed = follow({
    db: couch.DB,
    httpAgent: request.defaults({ headers: { 'foo': 'bar' } }) // set header
  })
    .on('confirm_request', function(req) {
      t.ok(req.headers.foo, 'bar', 'Custom HTTP agent set header');
    })
    .on('change', function(change) {
      t.ok(getSeq(change.seq), 1, 'Got first change event');
      feed.stop();
      t.end();
    });
});

test('Events for DB confirmation and hitting the original seq', function(t) {
  t.plan(7)
  var feed = follow(couch.DB, on_change)

  var events = { 'confirm':null }
  feed.on('confirm', function(db) { events.confirm = db })
  feed.on('catchup', caught_up)

  // This will run 3 times.
  function on_change(er, ch) {
    t.false(er, 'No problem with the feed')
    if(getSeq(ch.seq) == 3) {
      t.ok(events.confirm, 'Confirm event fired')
      t.equal(events.confirm && events.confirm.db_name, 'follow_test', 'Confirm event returned the Couch DB object')
      t.equal(events.confirm && getSeq(events.confirm.update_seq), 3, 'Confirm event got the update_seq right')
    }
  }

  function caught_up(seq) {
    t.equal(getSeq(seq), 3, 'Catchup event fired on update 3')

    feed.stop()
    t.end()
  }
})

test('Handle a deleted database', function(t) {
  var feed = follow(couch.DB, function(er, change) {
    if(er){
      t.equal(getSeq(er.last_seq), 3, 'Got an error for the deletion event')
      return t.end()
    }

    if(getSeq(change.seq) < 3)
      return

    t.equal(getSeq(change.seq), 3, 'Got change number 3')

    couch.delete_db(t, function(er) {
      t.false(er, 'No problem deleting database')
    })
  })
})
