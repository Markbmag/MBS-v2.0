SELECT q_customers.id AS id 
FROM q_customers 
WHERE q_customers.name ILIKE '%50!%%' ESCAPE '!' ORDER BY "id" ASC 
 LIMIT 2000
