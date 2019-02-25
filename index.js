const es = require('event-stream');
const express = require('express');
const JSON2csv =require('json2csv');
const JSONStream = require('JSONStream');
const request = require('request');
const MultiStream = require('multistream');
const {PassThrough, Readable} = require('stream');

const app = express();

/*
 * This endpoint demonstrates how streams and TTFB
 * (time to first byte) are related.
 *
 * In this example, the TTFB will be about 100ms;
 * the entire request will take ~8000ms (TTLB, or
 * "time to last byte").
 */
app.get('/ttfb', (req, res) => {
  setTimeout(() => {
    res.write('hello world 1000ms\r\n');
  }, 1000);

  setTimeout(() => {
    res.write('hello world 3000ms\r\n');
  }, 3000);

  setTimeout(() => {
    res.write('hello world 5000ms\r\n');
    res.end();
  }, 5000);
});

/*
 * This endpoint does the same thing as "/ttfb",
 * however, it uses a Readable stream which is then
 * piped into the response (writable stream).
 * */
app.get('/ttfbWithPipe', (req, res) => {
  const stream = new Readable();
  stream._read = () => {};

  setTimeout(() => {
    stream.push('hello world 1000ms\r\n');
  }, 1000);

  setTimeout(() => {
    stream.push('hello world 3000ms\r\n');
  }, 3000);

  setTimeout(() => {
    stream.push('hello world 5000ms\r\n');
    stream.push(null);
  }, 5000);

  stream.pipe(res);
});

/*
 * This is a more complex use of streams. Here, we access a list of users
 * from a paginated JSON API and stream the results in CSV format.
 * 
 * As we loop through the paginated API, each HTTP response it's own stream.
 * We use the npm module 'multistream' to handle working with multiple streams.
 * 
 * Each response stream is forked into into two, so we can parse through the JSON
 * before making the next HTTP request. 
 * 
 * We check to see if we are at the end of the pagination API by checking
 * the 'total_pages' value in the JSON. At the end of the API, the callback is
 * given 'null' as the 2nd parameter to signal there are no more streams.
 * 
 * As each request is processed, multistream pipes the result through various
 * transport streams, before sending data to the writable response stream.
 * 
 * Run "curl http://0.0.0.0:3000/users -v" to see it in action!
 */
app.get('/users', async (req, res) => {
  console.log('GET /users');
  let next = 1;
  
  // These headers tell browsers to save the response to filesystem
  res.header('Content-Disposition', 'attachment; filename=users.csv');
  res.header('Content-Type', 'text/csv');

  function factory(cb) {
    const stream = request(`https://reqres.in/api/users?page=${next}`);

    // Create two streams to 'fork' the response into two.
    const paginationStream = stream.pipe(new PassThrough());
    const responseStream = stream.pipe(new PassThrough());

    // Get the next page, then return the second fork (responseStream)
    paginationStream
      .pipe(JSONStream.parse('total_pages'))
      .on('data', (totalPages) => {
        if (next <= totalPages) {
          next++;
          // Artifically slow down the response to demonstrate streaming
          setTimeout(() => {
            cb(null, responseStream);
          }, 1000);
        } else {
          cb(null, null);
        }
      })
  }

  /* To verify the data is being processed line-by-line,
   * the log will print "Pipe 1", then "Pipe 2", then 
   * "Pipe 1", etc.
   */
  MultiStream(factory)
    .pipe(JSONStream.parse('data'))
    .pipe(es.map(function (data, callback) {
      const result = JSON.stringify(data);
      console.log('Pipe 1:', result);
      callback(null, result);
    }))
    .pipe(new JSON2csv.Transform({
      fields: ['first_name', 'last_name'],
      quote: ''
    }))
    .pipe(es.map(function (data, callback) {
      console.log('Pipe 2:', data.toString('utf8').trim());
      callback(null, data);
    }))
    .pipe(res);
});

/* Convenience page for accessing the '/users' endpoint. */
app.get('/users/download', (req, res) => {
  res.contentType('html');
  res.end('<a href="/users">Download</a>')
});

/* How browsers handle streaming HTML */
app.get('/html', (req, res) => {
  res.write('<!DOCTYPE html><html>\r\n');

  setTimeout(() => {
    res.write('<head><title>Title @ 1000ms</title></head>\r\n');
  }, 1000);

  setTimeout(() => {
    res.write('<body>Body @ 3000ms\r\n');
  }, 3000);

  setTimeout(() => {
    res.write(`
      <script type="text/javascript">
        document.bgColor = "#00ff00";
        var elem = document.createElement('div');
        elem.innerHTML = 'Body green @ 5000ms (This line was added via JS).';
        document.body.append(elem);
      </script>\r\n
    `);
  }, 5000);

  setTimeout(() => {
    res.end('<div>End of document @ 7000ms.</div></body></html>\r\n');
  }, 7000);
});

app.listen(3000, () => console.log(`Example app listening on port 3000!`))
