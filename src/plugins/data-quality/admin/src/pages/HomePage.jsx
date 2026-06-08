import { getFetchClient } from '@strapi/strapi/admin';
import {
  Alert,
  Badge,
  Box,
  Flex,
  Loader,
  Main,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  Typography,
} from '@strapi/design-system';
import { useEffect, useState } from 'react';

const EMPTY_STATE = {
  queues: [],
  generatedAt: null,
  warnings: [],
};

function QueueTable({ queue }) {
  return (
    <Box background="neutral0" hasRadius shadow="tableShadow">
      <Flex padding={5} justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="delta" tag="h2">
            {queue.label}
          </Typography>
          <Typography textColor="neutral600">{queue.description}</Typography>
        </Box>
        <Badge>{queue.items.length}</Badge>
      </Flex>
      {queue.items.length === 0 ? (
        <Box padding={5} borderColor="neutral200" borderStyle="solid" borderWidth="1px 0 0">
          <Typography textColor="neutral600">No records currently match this queue.</Typography>
        </Box>
      ) : (
        <Table colCount={3} rowCount={queue.items.length}>
          <Thead>
            <Tr>
              <Th><Typography variant="sigma">Record</Typography></Th>
              <Th><Typography variant="sigma">Reason</Typography></Th>
              <Th><Typography variant="sigma">Action</Typography></Th>
            </Tr>
          </Thead>
          <Tbody>
            {queue.items.map((item) => (
              <Tr key={item.key}>
                <Td>
                  <Typography fontWeight="bold">{item.title}</Typography>
                </Td>
                <Td>
                  <Typography textColor="neutral600">{item.detail}</Typography>
                </Td>
                <Td>
                  {item.adminPath ? (
                    <a href={item.adminPath}>Open in Content Manager</a>
                  ) : (
                    <Typography textColor="neutral500">Source record only</Typography>
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </Box>
  );
}

function HomePage() {
  const [state, setState] = useState(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;

    getFetchClient()
      .get('/data-quality/queues')
      .then(({ data }) => {
        if (active) setState(data);
      })
      .catch(() => {
        if (active) setError('Data-quality queues could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <Main>
      <Box padding={8}>
        <Flex direction="column" alignItems="stretch" gap={6}>
          <Box>
            <Typography variant="alpha" tag="h1">Data Quality</Typography>
            <Typography textColor="neutral600">
              Operational queues for incomplete records and unresolved migration data.
            </Typography>
            {state.generatedAt && (
              <Typography textColor="neutral500">
                ETL report generated {new Date(state.generatedAt).toLocaleString()}
              </Typography>
            )}
          </Box>

          {loading && <Loader>Loading data-quality queues</Loader>}
          {error && <Alert closeLabel="Close" title="Unable to load queues" variant="danger">{error}</Alert>}
          {state.warnings.map((warning) => (
            <Alert key={warning} closeLabel="Close" title="Report warning" variant="warning">
              {warning}
            </Alert>
          ))}
          {!loading && !error && state.queues.map((queue) => (
            <QueueTable key={queue.id} queue={queue} />
          ))}
        </Flex>
      </Box>
    </Main>
  );
}

export { HomePage };
