SELECT q_customers.id AS id 
FROM q_customers 
WHERE q_customers.region != 'EU' OR q_customers.region IS NULL ORDER BY "id" ASC
 LIMIT 2000 OFFSET 0
