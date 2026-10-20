SELECT TOP 2000 q_customers.id AS id 
FROM q_customers 
WHERE q_customers.region != 'EU' OR q_customers.region IS NULL ORDER BY [id] ASC
